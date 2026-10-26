FIX|app.js|idbLoad reads only image keys (no getAll of bytes); posts/chats keep images as ids in memory; profile avatar/banner loaded at boot
FIX|app.js|added isImgId, LRU imgCache, imgReal/imgList/getImgs, fullState; doFlush idFor passes ids through; localStorage fallback and saveSnap hydrate first
FIX|app.js|mkImg placeholder + IntersectionObserver lazy fill (wireImg, lazyWatch); lightbox resolves async; imgH returns id as is
FIX|app.js|readers awaiting hydration: postPic, zipMediaAll/backup profile, uploadMedia, zAsk, zenChatMedia, notes push, saveSnap
FIX|style.css|img.lz placeholder box (aspect-ratio 4/3) to limit layout shift
TEST|tests/unit.js|lazy picture id/LRU/imgReal/fullState unit tests
TEST|tests/lazy.js|playwright: no getAll at boot, fill on scroll, save keeps images, export has all images; wired in tests/run.sh
