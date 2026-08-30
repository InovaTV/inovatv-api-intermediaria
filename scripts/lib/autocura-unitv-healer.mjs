// F4 da autocura do UNITV_DEALER_TOKEN (2026-08-30) -- NUCLEO TESTAVEL
// do healer. Toda a orquestracao (CAPTCHA -> gate -> 1 UNICO POST de
// login -> extrair token -> validar /api/account -> gravar SO' o Vault
// -> reler -> revalidar -> callback) vive aqui, com dependencias
// injetadas. O runner scripts/autocura-unitv-token.mjs so' liga as deps
// reais (Playwright/fetch/Supabase REST).
//
// Documento oficial: docs/renovacao_automatica/AUTOCURA_UNITV_DEALER_TOKEN.md
// (invariantes I1-I7; secao B / D).
//
// REGRAS TRAVADAS AQUI (ajuste obrigatorio 2026-08-30):
//   * NO MAXIMO 1 POST de login por ciclo. NUNCA um segundo, em nenhum
//     caso -- nem transporte, nem recusa. postLogin() e' chamado uma
//     unica vez, sem loop/retry ao redor.
//       CAPTCHA passou no gate -> 1 POST -> sucesso inequivoco: segue
//                                        -> qualquer nao-sucesso: login_recusado
//                                        -> transporte/timeout: login_transporte
//   * Token invalido / shape invalido / validacao falha -> NUNCA grava
//     o Vault (gravarVault so' e' chamado depois do /api/account 200).
//   * Sucesso -> grava o Vault (origem 'autocura', por 'healer') e
//     revalida lendo de volta. Revalidacao falha -> revalidacao_falhou
//     (estado critico -- o Vault pode conter token invalido).
//   * NUNCA /api/account/renew, /pagamento/add/, cobranca, nem
//     alteracao do Edge secret UNITV_DEALER_TOKEN.
//   * NUNCA loga: token, senha, login, CAPTCHA resolvido, SN ancora.
//     So' bucket de confianca + contadores. (I6)

const SHAPE_TOKEN = /^[0-9a-f]{32}$/;
const SHAPE_CODIGO = /^[0-9]{4}$/;

// Classes terminais de falha (== check de autocura_unitv_ciclos.failure_class).
export const FAIL = {
  CAPTCHA_SEM_CONFIANCA: "captcha_sem_confianca",
  LOGIN_RECUSADO: "login_recusado",
  LOGIN_TRANSPORTE: "login_transporte",
  TOKEN_SHAPE_INVALIDO: "token_shape_invalido",
  TOKEN_NOVO_INVALIDO: "token_novo_invalido",
  REVALIDACAO_FALHOU: "revalidacao_falhou",
  EXCECAO: "excecao",
};

/**
 * executarHealer -- orquestracao pura. Retorna um resumo e SEMPRE chama
 * deps.reportar() exatamente uma vez (o ciclo nunca fica orfao pelo
 * lado do runner).
 *
 * deps:
 *   cicloId            string
 *   cfg                { capRefreshCaptcha }
 *   capturarCaptcha()  -> { gray:Uint8Array, w:number, h:number } | null
 *   analisar(gray,w,h) -> { gateOk:boolean, bucket:'alta'|'media'|'baixa'|'n_a',
 *                           predicao:string }   (envolve analisarCaptcha + templates)
 *   refreshCaptcha()   -> void   ("Eu nao vejo"; NAO conta como login)
 *   postLogin(codigo)  -> { resultado:'sucesso'|'recusa'|'transporte', token?:string }
 *                          CHAMADO NO MAXIMO 1x.
 *   validarConta(token)-> { ok:boolean, returnCode?:number }   (/api/account read-only)
 *   gravarVault(token) -> void   (unitv_dealer_token_definir(token,'autocura','healer'))
 *   lerVault()         -> string | null   (unitv_dealer_token_ler)
 *   reportar(payload)  -> void   (POST autocura-unitv-resultado)
 *   log(evento, dados) -> void
 */
export async function executarHealer(deps) {
  const { cicloId, cfg, capturarCaptcha, analisar, refreshCaptcha, postLogin, validarConta, gravarVault, lerVault, reportar } = deps;
  const log = deps.log ?? (() => {});
  const capRefresh = Math.max(1, Number(cfg?.capRefreshCaptcha ?? 12));

  let refreshes = 0;
  let loginPosts = 0;
  let vaultGravado = false;
  let bucketFinal = "n_a";
  let postLoginChamado = 0; // trava dura -- prova nos testes que nunca ha 2o POST

  // reporta 1x + retorna
  const finalizar = async (outcome, failureClass, extra = {}) => {
    const payload = {
      ciclo_id: cicloId,
      outcome, // 'sucesso' | 'falhou'
      ...(failureClass ? { failure_class: failureClass } : {}),
      metrics: {
        captcha_refreshes: refreshes,
        captcha_confianca_bucket: bucketFinal,
        login_posts: loginPosts,
        vault_gravado: vaultGravado,
        ...extra,
      },
    };
    try { await reportar(payload); }
    catch (e) { log("reportar_erro", { ciclo_id: cicloId, erro: String(e) }); }
    return { outcome, failureClass: failureClass ?? null, refreshes, loginPosts, vaultGravado, postLoginChamado };
  };

  try {
    // ===================================================================
    // 1. CAPTCHA -> gate de ALTA confianca (refresh gratis ate o cap).
    //    Nenhum POST de login aqui.
    // ===================================================================
    let codigo = null;
    for (let tentativa = 0; ; tentativa++) {
      let cap;
      try { cap = await capturarCaptcha(); }
      catch (e) { log("captcha_erro", { ciclo_id: cicloId, erro: String(e) }); cap = null; }

      let r = null;
      if (cap && cap.gray) {
        try { r = analisar(cap.gray, cap.w, cap.h); }
        catch (e) { log("ocr_erro", { ciclo_id: cicloId, erro: String(e) }); r = null; }
      }

      const passou = !!r && r.gateOk === true && r.bucket === "alta" && SHAPE_CODIGO.test(String(r.predicao ?? ""));
      log("captcha_tentativa", {
        ciclo_id: cicloId,
        tentativa,
        bucket: r ? r.bucket : "n_a",
        gate: r ? r.gateOk : false,
        // NUNCA r.predicao (I6)
      });

      if (passou) {
        codigo = String(r.predicao); // transitorio, NUNCA logado
        bucketFinal = "alta";
        break;
      }

      refreshes++;
      if (refreshes >= capRefresh) {
        // estourou sem confianca -> aborta SEM nenhum POST
        return await finalizar("falhou", FAIL.CAPTCHA_SEM_CONFIANCA);
      }
      try { await refreshCaptcha(); } catch (e) { log("refresh_erro", { ciclo_id: cicloId, erro: String(e) }); }
    }

    // ===================================================================
    // 2. LOGIN -- 1 UNICO POST, sem loop, sem retry (ajuste 2026-08-30).
    // ===================================================================
    if (postLoginChamado !== 0) {
      // defesa em profundidade -- impossivel pelo fluxo acima
      return await finalizar("falhou", FAIL.EXCECAO);
    }
    postLoginChamado++;
    loginPosts = 1;
    let pl;
    try {
      pl = await postLogin(codigo);
    } catch (e) {
      log("login_excecao", { ciclo_id: cicloId, erro: String(e) });
      return await finalizar("falhou", FAIL.LOGIN_TRANSPORTE);
    }
    codigo = null; // descarta

    const resultado = pl && typeof pl.resultado === "string" ? pl.resultado : "recusa";
    if (resultado === "transporte") {
      // NAO repete o POST. CAPTCHA ja estava alta -> nao e' "talvez o captcha".
      return await finalizar("falhou", FAIL.LOGIN_TRANSPORTE);
    }
    if (resultado !== "sucesso") {
      // qualquer nao-sucesso -> credencial/lockout. Para. Nao usa 2o POST.
      return await finalizar("falhou", FAIL.LOGIN_RECUSADO);
    }

    // ===================================================================
    // 3. EXTRAIR + SHAPE do token novo.  Vault INTOCADO se falhar.
    // ===================================================================
    const tokenNovo = pl && typeof pl.token === "string" ? pl.token.trim() : "";
    if (!SHAPE_TOKEN.test(tokenNovo)) {
      log("token_shape", { ciclo_id: cicloId, ok: false });
      return await finalizar("falhou", FAIL.TOKEN_SHAPE_INVALIDO);
    }

    // ===================================================================
    // 4. VALIDAR read-only via /api/account.  Vault INTOCADO se falhar.
    // ===================================================================
    let v;
    try { v = await validarConta(tokenNovo); }
    catch (e) { log("validar_excecao", { ciclo_id: cicloId, erro: String(e) }); v = { ok: false }; }
    if (!v || v.ok !== true) {
      log("token_novo_invalido", { ciclo_id: cicloId, return_code: v && typeof v.returnCode === "number" ? v.returnCode : null });
      return await finalizar("falhou", FAIL.TOKEN_NOVO_INVALIDO, {
        ...(v && typeof v.returnCode === "number" ? { validar_return_code: v.returnCode } : {}),
      });
    }

    // ===================================================================
    // 5. GRAVAR -- SO' AGORA, SO' O VAULT (origem 'autocura', por 'healer').
    // ===================================================================
    try {
      await gravarVault(tokenNovo);
      vaultGravado = true;
      log("vault_gravado", { ciclo_id: cicloId });
    } catch (e) {
      log("vault_gravar_erro", { ciclo_id: cicloId, erro: String(e) });
      return await finalizar("falhou", FAIL.EXCECAO);
    }

    // ===================================================================
    // 6. REVALIDAR lendo de volta do Vault.  Falha aqui = CRITICO
    //    (o Vault pode conter token invalido).
    // ===================================================================
    let lido = null;
    try { lido = await lerVault(); } catch (e) { log("vault_ler_erro", { ciclo_id: cicloId, erro: String(e) }); }
    if (typeof lido !== "string" || lido.trim() !== tokenNovo) {
      log("revalidacao", { ciclo_id: cicloId, ok: false, motivo: "vault_diferente" });
      return await finalizar("falhou", FAIL.REVALIDACAO_FALHOU);
    }
    let v2;
    try { v2 = await validarConta(lido.trim()); }
    catch (e) { log("revalidar_excecao", { ciclo_id: cicloId, erro: String(e) }); v2 = { ok: false }; }
    if (!v2 || v2.ok !== true) {
      log("revalidacao", { ciclo_id: cicloId, ok: false, motivo: "api_account" });
      return await finalizar("falhou", FAIL.REVALIDACAO_FALHOU);
    }

    log("revalidacao", { ciclo_id: cicloId, ok: true });
    return await finalizar("sucesso", null);
  } catch (e) {
    log("healer_excecao", { ciclo_id: cicloId, erro: String(e) });
    return await finalizar("falhou", FAIL.EXCECAO);
  }
}
