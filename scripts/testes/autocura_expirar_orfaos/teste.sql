-- F3-A -- suite SQL de autocura_unitv_expirar_orfaos(). Roda contra
-- producao APOS aplicar a migration, com limpeza propria. Usa linhas
-- sinteticas (id proprio, deletadas ao fim). NAO toca ciclos reais.
--
-- OBS: o indice unico parcial autocura_unitv_ciclos_um_em_andamento_idx
-- (F1) permite so' 1 ciclo 'em_andamento' -> o teste e' SEQUENCIAL.
do $$
declare
  v_timeout integer;
  v_n integer;
  id_velho uuid;
  id_novo  uuid;
begin
  select orfao_timeout_min into v_timeout from public.autocura_unitv_config where id = 1;

  -- pre-condicao: nenhum ciclo em_andamento (senao o teste nao roda)
  if exists (select 1 from public.autocura_unitv_ciclos where estado = 'em_andamento') then
    raise exception 'PRE: existe ciclo em_andamento -- nao rodar o teste agora';
  end if;

  -- (1) 1 ciclo sintetico VELHO (alem do timeout)
  insert into public.autocura_unitv_ciclos (tipo, trigger, modo_observacao, iniciado_em)
  values ('calibracao','agendado', true, now() - make_interval(mins => v_timeout + 5))
  returning id into id_velho;

  -- expirar_orfaos fecha o velho
  select public.autocura_unitv_expirar_orfaos() into v_n;
  if v_n < 1 then raise exception 'ASSERT 1: deveria ter fechado >=1 (o velho), veio %', v_n; end if;
  if (select estado from public.autocura_unitv_ciclos where id = id_velho) <> 'concluido'
     or (select outcome from public.autocura_unitv_ciclos where id = id_velho) <> 'indeterminado'
     or (select failure_class from public.autocura_unitv_ciclos where id = id_velho) <> 'orfao'
     or (select ended_at from public.autocura_unitv_ciclos where id = id_velho) is null
  then raise exception 'ASSERT 2: o ciclo velho nao virou concluido/indeterminado/orfao'; end if;

  -- 2a chamada: idempotente (nada mais em_andamento)
  select public.autocura_unitv_expirar_orfaos() into v_n;
  if v_n <> 0 then raise exception 'ASSERT 3: 2a chamada deveria fechar 0, veio %', v_n; end if;

  -- (2) agora o indice esta livre -- 1 ciclo sintetico NOVO (dentro do timeout)
  insert into public.autocura_unitv_ciclos (tipo, trigger, modo_observacao, iniciado_em)
  values ('calibracao','agendado', true, now() - make_interval(mins => greatest(v_timeout - 5, 0)))
  returning id into id_novo;

  select public.autocura_unitv_expirar_orfaos() into v_n;
  if v_n <> 0 then raise exception 'ASSERT 4: NAO deveria fechar o ciclo novo (dentro do timeout), veio %', v_n; end if;
  if (select estado from public.autocura_unitv_ciclos where id = id_novo) <> 'em_andamento'
  then raise exception 'ASSERT 5: o ciclo novo foi fechado indevidamente'; end if;

  -- limpeza -- so' as 2 linhas sinteticas
  delete from public.autocura_unitv_ciclos where id in (id_velho, id_novo);
  if (select count(*) from public.autocura_unitv_ciclos where id in (id_velho, id_novo)) <> 0
  then raise exception 'ASSERT 6: limpeza incompleta'; end if;
end $$;
select 'PASS autocura_expirar_orfaos' as r,
  (select count(*) from public.autocura_unitv_ciclos) as ciclos_restantes;
