-- PROPOSTA DE CARGA INICIAL -- conhecimento_institucional (V1)
-- NAO EXECUTADO. Arquivo de revisao, referenciado por
-- PROPOSTA_CARGA_INICIAL_V1.md. Depende da migration
-- 20260822120000_conhecimento_institucional.sql ja ter sido aplicada
-- (tambem ainda nao aplicada).
--
-- 29 entradas: 2 catalogo_planos + 24 suporte_tecnico + 3 institucional.
-- Conteudo literal derivado de RASCUNHO_CONTEUDO_V1.md, sem invencao.
-- Fora desta carga (decisao ja registrada, nao repetida aqui): 2.24/4.6
-- (compatibilidade servidor x aplicativo x aparelho), Regras Gerais
-- (2.26 + Bloco 3), e o item 4.10 (indicacao/cancelamento/apresentacao/
-- outras condicoes comerciais).
--
-- Revisao rodada 3 (2026-08-22), aplicada nesta versao:
-- 1) "Teste gratis" -- removida frase comportamental que nao deveria
--    estar aqui ("confirme o servidor... nao presuma") -- fora da
--    carga V1 junto com o resto das regras transversais.
-- 2) "Aplicativo desatualizado" / "Problema depois de atualizar o
--    aplicativo" -- palavras-chave reformuladas para evitar colisao
--    (testado com o algoritmo real, script descartavel, ver relato na
--    conversa/PROPOSTA_CARGA_INICIAL_V1.md). Conteudo das duas
--    entradas NAO foi alterado.
-- Casos de canais (11/18/19 na numeracao de apresentacao) foram
-- testados e NAO alterados, por instrucao explicita -- ver achados no
-- PROPOSTA_CARGA_INICIAL_V1.md.

-- ============================================================
-- catalogo_planos (2)
-- ============================================================

insert into public.conhecimento_institucional (categoria, titulo, palavras_chave, conteudo) values
('catalogo_planos', 'Planos disponíveis',
 array['planos','valores','preco','precos','mensalidade','quanto custa','assinatura'],
$$Os planos disponíveis são: 30 dias — R$ 35,00; 90 dias — R$ 90,00; 180 dias — R$ 180,00; 365 dias — R$ 300,00. O catálogo de planos é único e não varia por servidor — servidor é informação do acesso individual do cliente, consultada separadamente.$$);

insert into public.conhecimento_institucional (categoria, titulo, palavras_chave, conteudo) values
('catalogo_planos', 'Teste grátis',
 array['teste','teste gratis','testar','experimentar','degustacao','cortesia'],
$$O teste grátis varia conforme o servidor do acesso: regra geral, 6 horas. ChannelTV: 6 horas. NewOne: 4 horas. Blaze: 2, 4, 6 ou 12 horas, conforme a modalidade disponível (incluindo opções sem conteúdo adulto). UniTV: 3 dias.$$);

-- ============================================================
-- suporte_tecnico (24)
-- ============================================================

insert into public.conhecimento_institucional (categoria, titulo, palavras_chave, conteudo) values
('suporte_tecnico', 'Não consigo entrar',
 array['login','entrar','nao consigo entrar','acesso negado'],
$$Identificar aplicativo e servidor. Confirmar que o cliente está usando o acesso correto. Conferir usuário e senha. Conferir se o servidor/provedor selecionado está correto. Se necessário, consultar o estado do acesso no cadastro. Se não resolver, transferir para humano. Não inventar credenciais nem afirmar que o acesso está vencido sem consultar o cadastro.$$);

insert into public.conhecimento_institucional (categoria, titulo, palavras_chave, conteudo) values
('suporte_tecnico', 'Usuário ou senha não funcionam',
 array['senha errada','usuario incorreto','senha nao funciona','credenciais'],
$$Confirmar aplicativo. Confirmar servidor. Conferir se usuário e senha foram digitados exatamente. Conferir espaços ou caracteres adicionais. Confirmar servidor/provedor selecionado. Consultar o estado do acesso se o problema persistir. Transferir se não houver solução. Nunca alterar ou inventar senha.$$);

insert into public.conhecimento_institucional (categoria, titulo, palavras_chave, conteudo) values
('suporte_tecnico', 'Meu acesso não aparece',
 array['acesso nao aparece','sumiu','nao encontro meu acesso'],
$$Primeiro identificar: aplicativo; servidor; aparelho; qual acesso o cliente está tentando utilizar. Se o acesso deveria existir, consultar o cadastro. Se houver divergência entre o que o cliente possui e o cadastro, transferir para humano. A IA não deve criar, alterar ou prometer um acesso.$$);

insert into public.conhecimento_institucional (categoria, titulo, palavras_chave, conteudo) values
('suporte_tecnico', 'Aplicativo não abre',
 array['nao abre','aplicativo nao abre','app nao inicia'],
$$Orientação inicial: fechar completamente o aplicativo; abrir novamente; reiniciar o aparelho; verificar se há atualização disponível. Se continuar, verificar se o problema ocorre somente naquele aplicativo. Se houver procedimento específico documentado para aquele aplicativo/aparelho, utilizar o procedimento específico. Se não resolver, transferir.$$);

insert into public.conhecimento_institucional (categoria, titulo, palavras_chave, conteudo) values
('suporte_tecnico', 'Aplicativo trava',
 array['travando','trava','congelou','travou'],
$$Fechar e abrir novamente. Reiniciar o aparelho. Verificar atualização. Verificar se há espaço disponível no aparelho. Se aplicável, limpar o cache do aplicativo. Se continuar, verificar se o problema ocorre apenas naquele aplicativo. Se não resolver, transferir.$$);

insert into public.conhecimento_institucional (categoria, titulo, palavras_chave, conteudo) values
('suporte_tecnico', 'Aplicativo fecha sozinho',
 array['fecha sozinho','cai','fechando sozinho','crash'],
$$Reiniciar aplicativo. Reiniciar aparelho. Verificar atualização. Verificar espaço disponível. Se aplicável, limpar cache. Se continuar, verificar se existe versão compatível/documentada para aquele aparelho. Se não houver solução documentada, transferir.$$);

insert into public.conhecimento_institucional (categoria, titulo, palavras_chave, conteudo) values
('suporte_tecnico', 'Canais travando',
 array['canal travando','canais travando','travamento'],
$$Verificar primeiro: se a internet está funcionando normalmente; se o problema ocorre em todos os canais ou apenas alguns; qual aplicativo está sendo utilizado; qual servidor está sendo utilizado. Se apenas alguns canais apresentarem problema, informar isso ao atendimento humano quando houver necessidade de transferência. Se todos os canais estiverem travando, fazer as verificações básicas de internet/aplicativo. Se persistir, transferir.$$);

insert into public.conhecimento_institucional (categoria, titulo, palavras_chave, conteudo) values
('suporte_tecnico', 'Canais carregando lentamente',
 array['lento','demorando','carregando devagar','lentidao'],
$$Verificar conexão de internet. Fechar outros aplicativos que possam estar consumindo conexão. Reiniciar aplicativo. Reiniciar aparelho e, se necessário, conexão de internet. Verificar se o problema ocorre em todos os canais. Persistindo, transferir.$$);

insert into public.conhecimento_institucional (categoria, titulo, palavras_chave, conteudo) values
('suporte_tecnico', 'Canais não carregam',
 array['canais nao carregam','nao carrega','sem sinal'],
$$Identificar: aplicativo; servidor; aparelho; se nenhum canal funciona ou apenas determinados canais. Verificar internet e reiniciar aplicativo. Se o problema persistir em todos os canais, transferir para análise.$$);

insert into public.conhecimento_institucional (categoria, titulo, palavras_chave, conteudo) values
('suporte_tecnico', 'Tela preta',
 array['tela preta','sem imagem','tela escura'],
$$Verificar: se há áudio; se ocorre em todos os canais ou apenas alguns; aplicativo utilizado; aparelho utilizado. Reiniciar aplicativo e aparelho. Se continuar, pedir print/foto da tela, quando isso ajudar a identificar o problema, e transferir se necessário.$$);

insert into public.conhecimento_institucional (categoria, titulo, palavras_chave, conteudo) values
('suporte_tecnico', 'Sem áudio',
 array['sem audio','sem som','mudo'],
$$Verificar: se o problema ocorre em todos os canais; volume do aparelho/TV; se o áudio está funcionando em outros aplicativos; se existe áudio em outro canal. Se for problema apenas do serviço e persistir após as verificações básicas, transferir.$$);

insert into public.conhecimento_institucional (categoria, titulo, palavras_chave, conteudo) values
('suporte_tecnico', 'Imagem congelada',
 array['imagem congelada','travando imagem','parada'],
$$Verificar internet. Trocar temporariamente de canal para verificar se ocorre somente naquele canal. Reiniciar aplicativo. Reiniciar aparelho. Se ocorrer em vários canais, transferir para análise.$$);

insert into public.conhecimento_institucional (categoria, titulo, palavras_chave, conteudo) values
('suporte_tecnico', 'EPG não aparece',
 array['epg','guia de programacao','grade de programacao'],
$$Primeiro confirmar: qual aplicativo; qual servidor; se os canais funcionam normalmente. Se apenas o EPG estiver ausente e os canais funcionarem, tratar como problema específico do aplicativo/servidor. Não inventar procedimento de atualização de EPG. Se houver procedimento documentado para aquele aplicativo, seguir o procedimento. Caso contrário, transferir.$$);

insert into public.conhecimento_institucional (categoria, titulo, palavras_chave, conteudo) values
('suporte_tecnico', 'Lista de canais não aparece',
 array['lista de canais','nao aparece lista','sem canais na lista'],
$$Verificar: se o usuário conseguiu entrar; se o aplicativo está configurado corretamente; servidor/provedor; se existe conexão com a internet. Se o acesso entra normalmente mas a lista não aparece, transferir para análise caso as verificações básicas não resolvam.$$);

insert into public.conhecimento_institucional (categoria, titulo, palavras_chave, conteudo) values
('suporte_tecnico', 'Filmes ou séries não carregam',
 array['filmes','series','vod','nao carrega filme'],
$$Verificar: se canais ao vivo funcionam; se o problema ocorre em todo o conteúdo ou somente em um item; aplicativo; servidor; conexão. Se apenas determinado conteúdo apresentar problema, registrar essa informação para o atendimento humano.$$);

insert into public.conhecimento_institucional (categoria, titulo, palavras_chave, conteudo) values
('suporte_tecnico', 'Problema somente em alguns canais',
 array['alguns canais','so alguns canais','determinado canal'],
$$Perguntar: quais canais; se outros canais funcionam normalmente; qual servidor; qual aplicativo. Não concluir automaticamente que é problema do cliente ou da internet. Se continuar, transferir informando quais canais apresentaram problema.$$);

insert into public.conhecimento_institucional (categoria, titulo, palavras_chave, conteudo) values
('suporte_tecnico', 'Problema em todos os canais',
 array['todos os canais','nenhum canal funciona'],
$$Verificar: internet; aplicativo; aparelho; servidor; se o cliente consegue entrar normalmente. Se as verificações básicas não resolverem, transferir.$$);

insert into public.conhecimento_institucional (categoria, titulo, palavras_chave, conteudo) values
('suporte_tecnico', 'Aplicativo desatualizado',
 array['desatualizado','versao antiga','versao desatualizada','tem atualizacao','existe atualizacao','atualizacao disponivel','qual a versao','versao mais recente','ultima versao'],
$$Orientar o cliente a verificar se existe atualização disponível na fonte oficial/loja do aparelho. Não mandar instalar versões aleatórias encontradas na internet. Quando a base de downloads própria estiver disponível, poderá direcionar o cliente para ela.$$);

insert into public.conhecimento_institucional (categoria, titulo, palavras_chave, conteudo) values
('suporte_tecnico', 'Problema depois de atualizar o aplicativo',
 array['atualizei','depois de atualizar','apos atualizar','apos a atualizacao','depois da atualizacao','parou depois de atualizar','parou apos atualizar','nao abre depois de atualizar','quebrou depois de atualizar','parou de funcionar depois da atualizacao'],
$$Perguntar: qual aplicativo; qual aparelho; quando ocorreu a atualização; qual problema apareceu depois dela. Se possível, pedir print da mensagem/tela. Não orientar downgrade ou instalação de versão desconhecida sem procedimento aprovado. Transferir se necessário.$$);

insert into public.conhecimento_institucional (categoria, titulo, palavras_chave, conteudo) values
('suporte_tecnico', 'Problema depois de trocar de aparelho',
 array['troquei de aparelho','novo aparelho','mudei de dispositivo'],
$$Confirmar: novo aparelho; aplicativo; servidor; usuário; senha. Verificar se o acesso permite utilização naquele aparelho. Se houver necessidade de alteração de cadastro ou alguma limitação do acesso, transferir.$$);

insert into public.conhecimento_institucional (categoria, titulo, palavras_chave, conteudo) values
('suporte_tecnico', 'Problema depois de trocar a internet',
 array['troquei de internet','nova internet','mudei o wifi'],
$$Verificar: se a internet funciona normalmente; se outros aplicativos funcionam; qual aparelho; qual aplicativo; se o problema começou exatamente após a troca. Fazer somente verificações de conexão seguras e conhecidas. Não mandar alterar DNS aleatoriamente. Se persistir, transferir.$$);

insert into public.conhecimento_institucional (categoria, titulo, palavras_chave, conteudo) values
('suporte_tecnico', 'Internet funciona, mas o serviço não funciona',
 array['internet funciona mas nao funciona o app','internet ok mas nao abre'],
$$Isso não significa automaticamente que o servidor esteja com problema. Verificar: aplicativo; servidor; acesso; se outros serviços de internet funcionam; se o problema ocorre em todos os conteúdos. Se o acesso estiver correto e o problema persistir, transferir para análise.$$);

insert into public.conhecimento_institucional (categoria, titulo, palavras_chave, conteudo) values
('suporte_tecnico', 'Precisa reinstalar o aplicativo',
 array['reinstalar','reinstalar aplicativo','reinstalar app'],
$$A IA pode orientar a reinstalação quando o procedimento estiver documentado para aquele aparelho/aplicativo. Antes de orientar: confirmar aplicativo; confirmar aparelho; confirmar servidor. Depois da reinstalação, o cliente precisará dos dados do próprio acesso. A IA não deve fornecer credenciais que não estejam associadas ao cliente.$$);

insert into public.conhecimento_institucional (categoria, titulo, palavras_chave, conteudo) values
('suporte_tecnico', 'Não sabe onde colocar usuário e senha',
 array['onde coloco usuario e senha','onde digitar usuario','configurar aplicativo'],
$$Primeiro identificar: servidor; aplicativo; aparelho. Depois orientar conforme o procedimento daquele aplicativo. Se o aplicativo utilizar campos como usuário, senha, provider, servidor, a IA poderá explicar onde cada informação deve ser colocada somente se isso estiver documentado para aquele aplicativo. Não inventar campos ou valores.$$);

-- ============================================================
-- institucional (3)
-- ============================================================

insert into public.conhecimento_institucional (categoria, titulo, palavras_chave, conteudo) values
('institucional', 'O que é a InovaTV',
 array['quem e','o que e a inovatv','sobre a empresa','quem voces sao'],
$$A InovaTV Central é o serviço de televisão por streaming da InovaTV.$$);

insert into public.conhecimento_institucional (categoria, titulo, palavras_chave, conteudo) values
('institucional', 'Atendimento e horário',
 array['horario','atendimento','whatsapp','atende','funcionamento'],
$$O canal oficial de atendimento é o WhatsApp. O atendimento pode começar pela IA e, quando necessário, ser encaminhado para um atendente humano. Horário normal: segunda a sábado, das 09:00 às 21:00. Domingos e feriados: atendimento conforme disponibilidade da equipe — não deve ser prometido fora desses horários.$$);

insert into public.conhecimento_institucional (categoria, titulo, palavras_chave, conteudo) values
('institucional', 'Reembolso',
 array['reembolso','dinheiro de volta','estorno','cancelamento com reembolso'],
$$Não há reembolso. A IA não deve prometer exceções que não estejam documentadas.$$);
