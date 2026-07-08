-- 032: The slides feature was removed from the app; drop its data-plane
-- objects. IRREVERSIBLE: deletes all saved decks and uploaded slide images.

DROP TABLE IF EXISTS public.presentations;

-- Objects must go before the bucket row.
DELETE FROM storage.objects WHERE bucket_id = 'slide-images';
DROP POLICY IF EXISTS "Public read slide images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated upload slide images" ON storage.objects;
DELETE FROM storage.buckets WHERE id = 'slide-images';
