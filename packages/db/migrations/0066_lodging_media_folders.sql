-- 0066_lodging_media_folders: lodging photos, videos and links in folders (T-192, ADR-026).
-- `lodging_properties.gallery` keeps its column; its JSON becomes
-- [{id, name, items: [{kind: 'image'|'video'|'link', url, caption}]}]. A flat [{url, caption}]
-- list becomes one folder "Ảnh chung" in the same order. Empty lists and rows that already hold
-- folders (an element with an `items` key) are left alone, so this file can run again safely.
-- `gallery_cover` '' = automatic (the first image of the first folder that has one).

ALTER TABLE lodging_properties ADD COLUMN IF NOT EXISTS gallery_cover text NOT NULL DEFAULT '';

UPDATE lodging_properties p
SET gallery = jsonb_build_array(jsonb_build_object(
  'id', gen_random_uuid()::text,
  'name', 'Ảnh chung',
  'items', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'kind', 'image',
      'url', g->>'url',
      'caption', coalesce(g->>'caption', '')
    ) ORDER BY ord)
    FROM jsonb_array_elements(p.gallery) WITH ORDINALITY AS e(g, ord)
    WHERE jsonb_typeof(g) = 'object' AND g ? 'url'
  ), '[]'::jsonb)
))
WHERE jsonb_typeof(p.gallery) = 'array'
  AND jsonb_array_length(p.gallery) > 0
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p.gallery) AS e(g)
    WHERE jsonb_typeof(g) = 'object' AND g ? 'items'
  );
