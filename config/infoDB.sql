SELECT `ndx`, `name`, `score`, `created`
FROM `rg_noy_hallOfFame`
ORDER BY `ndx` DESC
LIMIT :limit
