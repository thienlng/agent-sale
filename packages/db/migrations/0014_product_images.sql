-- T-053: product pictures the bot may send to customers. Additive: a nullable-free column with a
-- default, so the code deployed before this migration keeps working (it never reads or writes it).
-- Holds a JSON array of at most 5 https URLs; the API validates the shape, the CHECK keeps it an array.
alter table products add column if not exists image_urls jsonb not null default '[]'::jsonb;
alter table products drop constraint if exists products_image_urls_array;
alter table products add constraint products_image_urls_array
  check (jsonb_typeof(image_urls) = 'array' and jsonb_array_length(image_urls) <= 5);
