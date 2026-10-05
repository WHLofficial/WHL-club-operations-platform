-- 预检（只读）：巴萨（241）球场名现状 + 字节级指纹（判断是否已是目标值/是否被通道改坏）
SELECT club_id, name, hex(name) AS name_hex, length(name) AS name_chars, capacity, tier, updated_at FROM stadiums WHERE club_id = 241;
SELECT COUNT(*) AS stadiums_total FROM stadiums;
