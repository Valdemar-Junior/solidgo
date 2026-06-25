create or replace function public.normalize_store_release_location(p_value text)
returns text
language plpgsql
immutable
as $function$
declare
  v_raw text;
  v_plain text;
begin
  v_raw := upper(trim(regexp_replace(coalesce(p_value, ''), '\s+', ' ', 'g')));

  if v_raw = 'ATACADO LOJA ASSU' then
    return 'ATACADO LOJA ASSU';
  end if;

  if v_raw in (U&'LOJA MOSSOR\00D3', 'LOJA MOSSORO') then
    return 'LOJA MOSSORO';
  end if;

  if v_raw in (U&'LOJA MOSSOR\00D3 PARTAGE', 'LOJA MOSSORO PARTAGE') then
    return 'LOJA MOSSORO PARTAGE';
  end if;

  v_plain := translate(
    v_raw,
    U&'\00C1\00C0\00C2\00C3\00C4\00C9\00C8\00CA\00CB\00CD\00CC\00CE\00CF\00D3\00D2\00D4\00D5\00D6\00DA\00D9\00DB\00DC\00C7',
    'AAAAAEEEEIIIIOOOOOUUUUC'
  );

  if v_plain = 'ATACADO LOJA ASSU' then
    return 'ATACADO LOJA ASSU';
  end if;

  if v_plain = 'LOJA MOSSORO' then
    return 'LOJA MOSSORO';
  end if;

  if v_plain = 'LOJA MOSSORO PARTAGE' then
    return 'LOJA MOSSORO PARTAGE';
  end if;

  return v_raw;
end;
$function$;

select public.sync_store_release_for_open_orders();
