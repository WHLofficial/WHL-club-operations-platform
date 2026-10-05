-- 验收（只读）：期望 name='诺坎普球场'（hex E8AFBAE59D8EE699AEE79083E59CBA，5 字）、updated_at 为本批时间戳
SELECT club_id, name, hex(name) AS name_hex, length(name) AS name_chars, updated_at FROM stadiums WHERE club_id = 241;
SELECT COUNT(*) AS other_clubs_untouched FROM stadiums WHERE club_id <> 241 AND updated_at = '2026-10-05T08:25:47.000Z';
