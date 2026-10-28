-- Roda uma vez, na criação do volume.
-- postgres: dono do schema, usado só pelas migrations.
-- hub_app: usado pela API em runtime; não é dono das tabelas e não ignora RLS.
create role hub_app login password 'hub_app' nobypassrls;
grant connect on database unimais_hub to hub_app;

-- Banco separado para os testes de integração.
create database unimais_hub_test;
grant connect on database unimais_hub_test to hub_app;
