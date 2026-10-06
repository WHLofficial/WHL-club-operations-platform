-- 回滚 ④ 效力 +0.5（逐行 +1，守卫 = 已减过的值）
-- 期望 changes = 517（517 份合同各 1 行）
UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 456 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 457 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 122 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 458 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 126 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 461 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 459 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 124 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 127 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 134 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 125 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 123 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 460 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 129 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 128 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 121 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 130 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 462 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 136 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 133 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 137 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 135 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 139 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 131 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 132 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 453 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 455 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 454 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 452 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 138 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 140 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 143 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 144 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 146 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 147 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 150 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 158 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 149 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 142 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 141 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 152 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 151 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 148 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 153 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 154 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 155 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 160 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 162 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 159 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 161 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 167 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 163 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 156 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 168 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 164 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 165 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 145 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 166 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 157 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 169 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 404 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 408 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 396 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 407 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 409 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 414 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 398 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 397 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 399 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 415 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 416 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 395 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 390 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 402 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 405 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 400 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 406 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 410 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 418 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 417 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 411 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 412 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 419 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 413 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 391 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 392 AND is_active = 1 AND service_ticks = -1;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 401 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 403 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 420 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 393 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 394 AND is_active = 1 AND service_ticks = -1;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 334 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 340 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 335 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 336 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 339 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 342 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 337 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 343 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 353 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 341 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 346 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 338 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 359 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 344 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 348 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 354 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 347 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 283 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 118 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 352 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 117 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 349 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 351 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 119 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 120 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 355 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 360 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 350 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 356 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 345 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 357 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 361 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 358 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 362 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 284 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 285 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 333 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 288 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 292 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 289 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 290 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 295 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 291 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 308 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 296 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 300 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 298 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 302 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 301 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 286 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 303 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 294 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 304 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 293 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 297 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 305 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 299 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 306 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 287 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 310 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 307 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 309 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 373 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 371 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 374 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 379 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 378 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 375 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 376 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 377 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 382 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 383 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 372 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 384 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 385 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 380 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 381 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 386 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 388 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 389 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 367 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 387 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 369 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 368 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 370 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 263 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 262 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 274 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 265 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 270 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 260 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 266 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 264 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 261 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 278 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 267 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 282 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 272 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 271 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 268 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 269 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 276 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 279 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 273 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 275 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 277 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 280 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 281 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 206 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 205 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 210 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 214 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 209 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 224 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 216 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 211 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 225 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 207 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 208 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 218 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 219 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 227 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 226 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 212 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 228 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 233 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 220 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 217 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 232 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 222 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 223 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 234 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 200 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 229 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 202 AND is_active = 1 AND service_ticks = -1;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 215 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 235 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 221 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 201 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 236 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 203 AND is_active = 1 AND service_ticks = -1;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 230 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 204 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 213 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 231 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 314 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 317 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 315 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 318 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 320 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 325 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 324 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 316 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 326 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 321 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 319 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 327 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 330 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 329 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 332 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 365 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 323 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 322 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 363 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 311 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 366 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 331 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 364 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 328 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 312 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 313 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 425 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 428 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 426 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 440 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 429 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 432 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 435 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 431 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 436 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 442 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 433 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 427 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 437 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 443 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 441 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 439 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 434 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 445 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 430 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 438 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 444 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 448 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 446 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 447 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 421 AND is_active = 1 AND service_ticks = -1;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 449 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 422 AND is_active = 1 AND service_ticks = -1;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 423 AND is_active = 1 AND service_ticks = -1;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 424 AND is_active = 1 AND service_ticks = -1;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 451 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 450 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 90 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 86 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 89 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 87 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 88 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 92 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 96 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 109 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 98 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 93 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 95 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 91 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 110 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 101 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 100 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 111 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 97 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 102 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 99 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 103 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 104 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 112 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 94 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 105 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 116 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 106 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 107 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 113 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 114 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 115 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 108 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 5 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 8 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 10 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 6 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 7 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 12 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 11 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 14 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 13 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 17 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 9 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 19 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 27 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 21 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 15 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 20 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 1 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 22 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 28 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 18 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 23 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 29 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 25 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 16 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 24 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 4 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 2 AND is_active = 1 AND service_ticks = -1;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 26 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 3 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 469 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 470 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 471 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 472 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 481 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 490 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 485 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 473 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 480 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 482 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 487 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 486 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 483 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 474 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 478 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 475 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 476 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 488 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 477 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 479 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 484 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 463 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 464 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 465 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 491 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 466 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 467 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 468 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 489 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 238 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 240 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 251 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 254 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 250 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 239 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 242 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 241 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 247 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 252 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 246 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 244 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 243 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 255 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 248 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 249 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 258 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 245 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 237 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 253 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 256 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 257 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 259 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 184 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 177 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 178 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 185 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 189 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 183 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 186 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 179 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 191 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 190 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 195 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 188 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 193 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 192 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 194 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 199 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 196 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 175 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 197 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 174 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 181 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 198 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 187 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 170 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 176 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 182 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 180 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 171 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 172 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 173 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 66 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 68 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 67 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 71 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 69 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 70 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 76 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 84 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 85 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 73 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 74 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 77 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 75 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 61 AND is_active = 1 AND service_ticks = -1;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 72 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 79 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 80 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 83 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 78 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 62 AND is_active = 1 AND service_ticks = -1;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 63 AND is_active = 1 AND service_ticks = -1;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 81 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 82 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 64 AND is_active = 1 AND service_ticks = -1;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 65 AND is_active = 1 AND service_ticks = -1;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 38 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 39 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 40 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 51 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 44 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 42 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 47 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 43 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 45 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 41 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 46 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 54 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 48 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 56 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 55 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 50 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 57 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 58 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 49 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 52 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 53 AND is_active = 1 AND service_ticks = -5;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 60 AND is_active = 1 AND service_ticks = -3;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 59 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 30 AND is_active = 1 AND service_ticks = -2;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 31 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 33 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 32 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 34 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 35 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 36 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 37 AND is_active = 1 AND service_ticks = -4;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 496 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 499 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 492 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 500 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 497 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 502 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 507 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 503 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 493 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 508 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 495 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 509 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 494 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 506 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 504 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 498 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 511 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 514 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 501 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 512 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 513 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 505 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 515 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 516 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 510 AND is_active = 1 AND service_ticks = 0;

UPDATE contracts SET service_ticks = service_ticks + 1 WHERE id = 517 AND is_active = 1 AND service_ticks = 0;
