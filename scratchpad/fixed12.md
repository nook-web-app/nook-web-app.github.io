FIX|app.js|picture shapes: imgAR map persisted in own kv record "imgar" (state2 untouched); arSet/arSave/arLoad, imgDims/dataDims header parsers (PNG/JPEG/WebP/GIF), arMeasure
FIX|app.js|ratio recorded when a picture is first saved (doFlush fresh) and on every load of a shown picture; pruned with knownIds
FIX|app.js|arBackfill: idle-time, 4 records per slice, one record at a time, started 3s after boot
FIX|app.js|mkImg/arHold: placeholder gets --ar, box kept until load event (previously lz removed before src loaded)
FIX|style.css|img.lz aspect-ratio var(--ar,4/3); .imgs.n1 img.lz and .zimgs img.lz share max-height with real image
TEST|tests/lazy.js|portrait+landscape placeholder height == final within 1px (iPhone 13), backfill, imgar record, state2 unchanged
TEST|tests/unit.js|header parsers
