-- Login com Google e "Visualizar acesso" (o admin navega como outro usuário, só leitura).
-- Tudo passa por funções security definer: hub_app continua sem acesso a sessions.

/**
 * Login com Google: a API já validou o token do Google (e-mail verificado). Só entra quem já
 * está cadastrado e ativo; ninguém cria conta sozinho. Devolve o id do usuário ou null.
 */
create function app.auth_login_google(p_email text, p_token_hash text, p_ip inet, p_user_agent text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid;
begin
  select id into v_user from users where email = lower(p_email) and is_active;
  if v_user is null then
    insert into audit_log (actor_id, action, target, ip, user_agent, details)
    values ((select id from users where email = lower(p_email)), 'login_failed', lower(p_email),
            p_ip, p_user_agent, jsonb_build_object('method', 'google'));
    return null;
  end if;

  delete from auth_lockouts where email = lower(p_email);
  insert into sessions (token_hash, user_id, remember, expires_at, ip, user_agent)
  values (p_token_hash, v_user, false, now() + interval '30 days', p_ip, p_user_agent);
  update users set last_login_at = now() where id = v_user;
  insert into audit_log (actor_id, action, target, ip, user_agent, details)
  values (v_user, 'login', lower(p_email), p_ip, p_user_agent, jsonb_build_object('method', 'google'));
  return v_user;
end $$;

/**
 * Resolve a sessão (mesmas regras de app.session_resolve) e diz em nome de quem a requisição roda.
 * A simulação só vale enquanto o dono da sessão for admin e o alvo estiver ativo e não for admin;
 * fora disso ela é desfeita aqui mesmo.
 */
create function app.session_lookup(p_token_hash text)
returns table (user_id uuid, acting_user_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid;
  v_target uuid;
begin
  v_user := app.session_resolve(p_token_hash);
  if v_user is null then
    return;
  end if;
  select s.impersonated_user_id into v_target from sessions s where s.token_hash = p_token_hash;
  if v_target is not null and not (
    app.is_admin_as(v_user)
    and exists (select 1 from users u where u.id = v_target and u.is_active and u.role <> 'admin')
  ) then
    update sessions set impersonated_user_id = null where token_hash = p_token_hash;
    v_target := null;
  end if;
  return query select v_user, coalesce(v_target, v_user);
end $$;

/** Liga (p_target) ou desliga (null) a simulação da sessão. Só admin; tudo vai para a auditoria. */
create function app.session_impersonate(p_token_hash text, p_target uuid, p_ip inet, p_user_agent text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid;
  v_previous uuid;
  v_email text;
begin
  select s.user_id, s.impersonated_user_id into v_user, v_previous
  from sessions s where s.token_hash = p_token_hash;
  if v_user is null or not app.is_admin_as(v_user) then
    raise exception 'Só administradores podem visualizar o acesso de outro usuário.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_target is not null then
    select u.email into v_email from users u
    where u.id = p_target and u.is_active and u.role <> 'admin';
    if v_email is null then
      raise exception 'Escolha um usuário ativo que não seja administrador.' using errcode = 'check_violation';
    end if;
  end if;

  update sessions set impersonated_user_id = p_target where token_hash = p_token_hash;

  if p_target is not null then
    insert into audit_log (actor_id, action, target, ip, user_agent)
    values (v_user, 'access_preview_started', v_email, p_ip, p_user_agent);
  elsif v_previous is not null then
    insert into audit_log (actor_id, action, target, ip, user_agent)
    values (v_user, 'access_preview_stopped', (select u.email from users u where u.id = v_previous),
            p_ip, p_user_agent);
  end if;
end $$;

revoke execute on function app.auth_login_google(text, text, inet, text) from public;
revoke execute on function app.session_lookup(text) from public;
revoke execute on function app.session_impersonate(text, uuid, inet, text) from public;
grant execute on function app.auth_login_google(text, text, inet, text) to hub_app;
grant execute on function app.session_lookup(text) to hub_app;
grant execute on function app.session_impersonate(text, uuid, inet, text) to hub_app;
