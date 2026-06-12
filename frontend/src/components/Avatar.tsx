// Contenu d'avatar (#87) — à placer DANS un conteneur d'avatar déjà stylé
// (cercle, dégradé, centrage : .list-row__avatar, .avatar du header, etc.).
// Affiche l'image si présente, sinon les initiales (comportement antérieur).
// L'image remplit le cercle et se découpe elle-même (border-radius hérité).

function initials(name: string): string {
  return name.replace(/[^A-Za-zÀ-ÿ0-9]/g, '').slice(0, 2).toUpperCase();
}

export function AvatarContent({ src, name }: { src?: string | null; name: string }) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit', display: 'block' }}
      />
    );
  }
  return <>{initials(name)}</>;
}
