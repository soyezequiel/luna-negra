-- Renombra la categoría curada `casino` a `timba` en juegos existentes.
-- Preserva el orden original y evita duplicar `timba` si ambos slugs convivían.
UPDATE "Game" g
SET "categories" = COALESCE(
  (
    SELECT array_agg(mapped ORDER BY first_ord)
    FROM (
      SELECT mapped, min(ord) AS first_ord
      FROM (
        SELECT
          CASE WHEN item = 'casino' THEN 'timba' ELSE item END AS mapped,
          ord
        FROM unnest(g."categories") WITH ORDINALITY AS u(item, ord)
      ) mapped_categories
      GROUP BY mapped
    ) deduplicated_categories
  ),
  ARRAY[]::TEXT[]
)
WHERE 'casino' = ANY(g."categories");
