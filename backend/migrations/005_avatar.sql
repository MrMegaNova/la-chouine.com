-- Avatar (#87) : image de profil stockée en data URL (base64), petite et
-- carrée, redimensionnée côté client. Suffisant pour un avatar (~quelques Ko) ;
-- une migration vers un stockage objet sera possible plus tard sans changer
-- l'API (le champ resterait l'URL servie).
ALTER TABLE users ADD COLUMN avatar TEXT;
