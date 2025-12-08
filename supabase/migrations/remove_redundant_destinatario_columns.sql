-- Backfill address_json from legacy destinatario_* columns, then drop them
do $$
begin
  -- Ensure address_json exists
  update public.orders set address_json = '{}'::jsonb where address_json is null;

  -- street
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='destinatario_endereco') then
    update public.orders
      set address_json = jsonb_set(address_json, '{street}', to_jsonb(destinatario_endereco))
      where destinatario_endereco is not null
        and (address_json->>'street' is null or address_json->>'street' = '');
  end if;

  -- neighborhood
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='destinatario_bairro') then
    update public.orders
      set address_json = jsonb_set(address_json, '{neighborhood}', to_jsonb(destinatario_bairro))
      where destinatario_bairro is not null
        and (address_json->>'neighborhood' is null or address_json->>'neighborhood' = '');
  end if;

  -- city
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='destinatario_cidade') then
    update public.orders
      set address_json = jsonb_set(address_json, '{city}', to_jsonb(destinatario_cidade))
      where destinatario_cidade is not null
        and (address_json->>'city' is null or address_json->>'city' = '');
  end if;

  -- zip
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='destinatario_cep') then
    update public.orders
      set address_json = jsonb_set(address_json, '{zip}', to_jsonb(destinatario_cep))
      where destinatario_cep is not null
        and (address_json->>'zip' is null or address_json->>'zip' = '');
  end if;

  -- complement
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='destinatario_complemento') then
    update public.orders
      set address_json = jsonb_set(address_json, '{complement}', to_jsonb(destinatario_complemento))
      where destinatario_complemento is not null
        and (address_json->>'complement' is null or address_json->>'complement' = '');
  end if;

  -- Drop legacy columns if they exist
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='destinatario_endereco') then
    alter table public.orders drop column destinatario_endereco;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='destinatario_bairro') then
    alter table public.orders drop column destinatario_bairro;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='destinatario_cidade') then
    alter table public.orders drop column destinatario_cidade;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='destinatario_cep') then
    alter table public.orders drop column destinatario_cep;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='destinatario_complemento') then
    alter table public.orders drop column destinatario_complemento;
  end if;
end $$;
