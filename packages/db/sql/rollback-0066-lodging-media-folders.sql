-- Reverse of migration 0066_lodging_media_folders (T-192, ADR-026). NOT a migration: the runner
-- never applies this folder. Run it by hand before rolling back past T-192
-- (docs/runbooks/deploy-vps.md, "Rolling back T-192 (migration 0066)").
-- Flattens folder galleries [{id, name, items: [{kind, url, caption}]}] back to the flat
-- [{url, caption}] list the earlier release reads: image items only, in folder order then item
-- order, caption kept. Videos, links and folder names are dropped. Flat and empty galleries are
-- left alone, so this file can run again safely. It changes nothing else (gallery_cover and
-- schema_migrations stay as they are).

UPDATE lodging_properties p
SET gallery = coalesce((
  SELECT jsonb_agg(jsonb_build_object(
    'url', it->>'url',
    'caption', coalesce(it->>'caption', '')
  ) ORDER BY f_ord, i_ord)
  FROM jsonb_array_elements(p.gallery) WITH ORDINALITY AS f(folder, f_ord)
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(folder->'items') = 'array' THEN folder->'items' ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS i(it, i_ord)
  WHERE jsonb_typeof(it) = 'object' AND it->>'kind' = 'image' AND it ? 'url'
), '[]'::jsonb)
WHERE jsonb_typeof(p.gallery) = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(p.gallery) AS e(g)
    WHERE jsonb_typeof(g) = 'object' AND g ? 'items'
  );
