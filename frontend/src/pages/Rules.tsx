// Page Règles — rédigée d'après la « Règle du jeu de la Chouine » de Jacques
// Proust, éditée par l'association de sauvegarde du château de Lavardin
// (regles_chouine.pdf à la racine du dépôt).

function Ex({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="rules-example">
      {title && <p><b>{title}</b></p>}
      {children}
    </div>
  );
}

export default function Rules() {
  return (
    <div className="wrap" style={{ padding: '36px 0 60px' }}>
      <h2 className="section-title">Les règles de la Chouine</h2>
      <p className="section-sub">
        Version classique, telle que pratiquée dans la Vallée du Loir — d'après la règle
        de Jacques Proust éditée par l'association de sauvegarde du château de Lavardin.
      </p>

      {/* ── Les mots du jeu ─────────────────────────────────────────────── */}
      <div className="panel rules">
        <h3 style={{ marginTop: 0 }}>Avant de jouer : les mots de la Chouine</h3>
        <p>
          Quatre notions suffisent pour comprendre une table de Chouine : la <b>donne</b>,
          le <b>talon</b>, la <b>retourne</b> et les <b>brisques</b>. Prenez une minute
          pour les apprivoiser — tout le reste en découle.
        </p>

        <h3>La donne</h3>
        <p>
          La <b>donne</b>, c'est la distribution des cartes. Au début du match, chaque
          joueur tire une carte : <b>la plus petite désigne le donneur</b>. Le donneur
          mélange, fait couper à son adversaire, puis distribue <b>cinq cartes</b> à
          chacun, une par une, en commençant par l'adversaire. Il retourne ensuite
          la <b>onzième carte</b> face visible : c'est la <b>retourne</b>, qui fixe
          la couleur d'<b>atout</b>. Le reste du paquet, posé face cachée, forme
          le <b>talon</b>.
        </p>
        <p>
          C'est toujours <b>l'adversaire du donneur qui joue la première carte</b>.
          À chaque nouveau coup, le donneur change (alternance) — sauf après un coup
          nul, où le même joueur redonne.
        </p>
        <Ex title="Exemple">
          <p>
            Léa donne : 5 cartes à Marc, 5 à elle, puis elle retourne la 11ᵉ carte —
            le <b>9♥</b>. L'atout du coup sera donc <b>cœur</b>, et il reste 21 cartes
            au talon. Marc, adversaire de la donneuse, entame le premier pli.
          </p>
        </Ex>

        <h3>Le talon</h3>
        <p>
          Le <b>talon</b> est le paquet des cartes non distribuées, posé face cachée à
          côté de la retourne. Après chaque pli, <b>le gagnant du pli pioche la première
          carte du talon, puis son adversaire pioche à son tour</b> : chacun retrouve
          ainsi cinq cartes en main. Quand le talon s'épuise, la retourne elle-même est
          ramassée comme dernière pioche.
        </p>
        <p>
          Le talon commande la règle la plus importante du jeu — celle qui déroute tous
          les habitués de la belote. La partie a <b>deux phases</b> :
        </p>
        <ul>
          <li>
            <b>Tant qu'il reste des cartes au talon</b> : liberté totale. On n'est jamais
            obligé de fournir la couleur demandée, ni de couper, ni de monter. On peut
            se défausser de n'importe quelle carte.
          </li>
          <li>
            <b>Quand le talon est épuisé</b> : les obligations s'installent. Il faut{' '}
            <b>fournir</b> à la couleur demandée ; si l'atout est demandé, il faut{' '}
            <b>monter</b> (jouer plus fort) si on le peut ; et si l'on n'a pas la couleur
            demandée, il faut <b>couper</b> avec un atout si on en possède.
          </li>
        </ul>
        <Ex title="Exemple — phase talon">
          <p>
            Il reste des cartes au talon. Marc entame de l'<b>As♦</b>. Léa n'a aucune
            obligation : elle se défausse de son <b>7♣</b> et garde ses beaux carreaux.
            Marc remporte le pli (11 points dans sa pile), pioche en premier, et rejoue.
          </p>
        </Ex>
        <Ex title="Exemple — talon épuisé">
          <p>
            Le talon est vide, l'atout est cœur. Marc entame du <b>R♥</b> (atout). Léa a
            le 7♥ et l'As♥ : demandée à l'atout, elle doit <b>monter</b> → elle est
            obligée de jouer l'<b>As♥</b>, pas le 7. Si elle n'avait eu aucun cœur mais
            un atout… elle n'en aurait pas eu besoin ici — mais sur une entame
            au <b>R♦</b> sans carreau en main, elle aurait dû <b>couper</b> d'un cœur.
          </p>
        </Ex>

        <h3>La retourne et le 7 d'atout</h3>
        <p>
          La <b>retourne</b> reste visible à côté du talon pendant toute la phase de
          pioche. Le joueur qui détient le <b>7 d'atout</b> peut, à son tour de jeu,
          l'<b>échanger contre la retourne</b> — un troc presque toujours gagnant,
          la retourne étant souvent plus forte. Quand il ne reste plus que <b>deux
          cartes au talon</b>, le joueur qui s'apprête à entamer doit annoncer
          « <b>au sept</b> » si l'échange n'a pas encore été fait : dernier appel
          avant que la retourne ne soit ramassée.
        </p>
        <Ex title="Exemple">
          <p>
            La retourne est la <b>D♠</b> (atout pique). Léa pioche le <b>7♠</b> : à son
            prochain tour, elle pose le 7♠ sous le talon et prend la Dame — 3 points de
            mieux dans sa main, et une future annonce de mariage peut-être…
          </p>
        </Ex>

        <h3>Les brisques</h3>
        <p>
          Les <b>As et les Dix</b> s'appellent <b>brisques</b>. Il y en a donc{' '}
          <b>huit</b> dans le jeu (4 As + 4 Dix). Ce sont les cartes qui font les
          points : à elles seules, elles valent <b>84 des 120 points</b> de cartes du
          jeu (4 × 11 + 4 × 10). Gagner des plis ne sert à rien si l'on n'y ramasse pas
          de brisques — toute la stratégie de la Chouine tourne autour de leur capture
          et de leur protection.
        </p>
        <Ex title="Exemple">
          <p>
            Un pli contenant <b>As♣ + 10♣</b> vaut 21 points. Un pli contenant{' '}
            <b>R♦ + D♦</b> n'en vaut que 7 : capturer les brisques adverses (et mettre
            les vôtres à l'abri) compte plus que ramasser beaucoup de plis.
          </p>
        </Ex>

        <h3>Le pli (ou levée)</h3>
        <p>
          Les cartes jouées en un tour forment le <b>pli</b>. Il revient à celui qui a
          joué la carte la plus forte dans la couleur demandée, ou qui a coupé à
          l'atout — et si l'adversaire n'a pas fourni (phase talon), au premier joueur.
          Le gagnant du pli <b>a la main</b> : il pioche en premier et entame le pli
          suivant. Vous pouvez consulter vos propres plis à tout moment, mais un seul
          pli adverse : le dernier.
        </p>
      </div>

      {/* ── Le coup en détail ───────────────────────────────────────────── */}
      <h2 className="section-title" style={{ marginTop: 36 }}>Le déroulement d'un coup</h2>
      <div className="panel rules" style={{ marginTop: 14 }}>
        <div className="rules-cols">
          <h3 style={{ marginTop: 0 }}>Le matériel</h3>
          <p>
            Un jeu de 32 cartes (7, 8, 9, 10, Valet, Dame, Roi, As) dans les quatre
            couleurs : ♠ pique, ♥ cœur, ♦ carreau, ♣ trèfle.
          </p>

          <h3>Ordre &amp; valeur des cartes</h3>
          <p>
            Attention, l'ordre n'est pas celui de la bataille :{' '}
            <b>As &gt; 10 &gt; Roi &gt; Dame &gt; Valet &gt; 9 &gt; 8 &gt; 7</b>.
          </p>
          <table>
            <tbody>
              <tr><td>As</td><td>11 pts</td></tr>
              <tr><td>Dix</td><td>10 pts</td></tr>
              <tr><td>Roi</td><td>4 pts</td></tr>
              <tr><td>Dame</td><td>3 pts</td></tr>
              <tr><td>Valet</td><td>2 pts</td></tr>
              <tr><td>9, 8, 7</td><td>0 pt</td></tr>
            </tbody>
          </table>
          <Ex title="Le piège classique">
            <p>
              Marc joue le <b>R♠</b>, sûr de lui. Léa pose le <b>10♠</b>… et ramasse le
              pli : à la Chouine, <b>le Dix bat le Roi</b>. Quatorze points changent de camp.
            </p>
          </Ex>

          <h3>Jouer un pli</h3>
          <p>
            Celui qui a la main entame ; l'autre répond. Le pli revient à la plus forte
            carte de la couleur demandée, ou à l'atout si quelqu'un a coupé. Le gagnant
            pioche en premier, puis entame le pli suivant. Une carte posée sur le tapis
            est jouée — on ne la reprend pas.
          </p>
          <p>
            <b>Talon présent :</b> aucune obligation, on joue librement.<br />
            <b>Talon épuisé :</b> fournir la couleur, <b>monter</b> si l'atout est
            demandé, <b>couper</b> si l'on ne peut pas fournir.
          </p>

          <h3>Les annonces (2 joueurs)</h3>
          <p>
            Une <b>annonce</b> est une combinaison réunie dans votre main, déclarée au
            moment où vous jouez une carte — uniquement quand vous <em>avez la main</em>.
            À l'atout, mariage, tierce et quarteron valent <b>double</b>. Les annonces ne
            sont <b>jamais obligatoires</b> : on peut en taire une pour ne pas renseigner
            l'adversaire.
          </p>
          <table>
            <tbody>
              <tr><td>Mariage (R + D même couleur)</td><td>20 / 40</td></tr>
              <tr><td>Tierce (R + D + V)</td><td>30 / 60</td></tr>
              <tr><td>Quarteron (A + R + D + V)</td><td>40 / 80</td></tr>
              <tr><td>Quinte (5 brisques en main)</td><td>50</td></tr>
              <tr><td>Chouine (A + 10 + R + D + V)</td><td>gagne le coup</td></tr>
            </tbody>
          </table>
          <Ex title="Exemple">
            <p>
              Atout carreau. Léa a R♦ + D♦ en main et vient de ramasser un pli : en
              entamant le suivant, elle annonce son <b>mariage d'atout</b> → <b>40 points</b>{' '}
              (20 seulement s'il avait été à pique, cœur ou trèfle).
            </p>
          </Ex>

          <h3>Le décompte du coup</h3>
          <p>
            Quand toutes les cartes sont jouées : points des cartes ramassées + annonces
            + <b>10 points</b> pour le dernier pli (le <b>dix de der</b>). Le plus haut
            total remporte <b>le coup</b> (1 point de match). <b>Égalité = coup nul</b>,
            personne ne marque, même donneur.
          </p>

          <h3>La victoire</h3>
          <p>
            Le match se joue en <b>3 ou 5 coups gagnants</b>. Une <b>chouine</b> annoncée
            (A, 10, R, D, V d'une même couleur) fait gagner le coup immédiatement, sans
            finir la main.
          </p>
        </div>

        <Ex title="Exemple complet de décompte (tiré de la règle de Lavardin)">
          <p>
            <b>Jean</b> a ramassé : 3 As (33), 1 Dix (10), 1 Roi (4), 2 Dames (6),
            2 Valets (4) et des cartes blanches → <b>57 points de cartes</b>. Il ajoute
            son <b>mariage ordinaire (20)</b> et le <b>dix de der (10)</b> :{' '}
            <b>87 points</b>.
          </p>
          <p>
            <b>Charles</b> a ramassé : 1 As (11), 3 Dix (30), 3 Rois (12), 2 Dames (6),
            2 Valets (4) → <b>63 points de cartes</b>, plus son <b>mariage d'atout
            (40)</b> : <b>103 points</b>.
          </p>
          <p>
            <b>Charles gagne le coup</b> — malgré le dix de der de Jean : son mariage
            d'atout (40 contre 20) a fait la différence.
          </p>
        </Ex>
      </div>

      {/* ── 3-4 joueurs ─────────────────────────────────────────────────── */}
      <h2 className="section-title" style={{ marginTop: 36 }}>La Chouine à 3 ou 4 joueurs</h2>
      <div className="panel rules" style={{ marginTop: 14 }}>
        <p>Les règles à deux s'appliquent, sauf :</p>
        <ul>
          <li><b>3 cartes</b> chacun. Retourne = 10ᵉ carte (3 joueurs) ou 13ᵉ (4 joueurs).</li>
          <li>À 3 joueurs, les <b>2 dernières cartes</b> du talon ne sont pas tirées.</li>
          <li>Le gagnant du pli pioche en premier, puis les autres dans l'ordre du jeu.</li>
          <li>Le <b>plus grand total de points</b> remporte le coup. Égalité → coup nul.</li>
        </ul>
        <h3>Annonces à 3/4 joueurs</h3>
        <table>
          <tbody>
            <tr><td>Mariage (R + D)</td><td>20 / 40 (atout)</td></tr>
            <tr><td>Trente (3 brisques en main)</td><td>30</td></tr>
            <tr><td>Chouine (R + D + V même couleur)</td><td>gagne le coup</td></tr>
          </tbody>
        </table>
      </div>

      {/* ── Mondoubleau ─────────────────────────────────────────────────── */}
      <h2 className="section-title" style={{ marginTop: 36 }}>La Chouine de Mondoubleau</h2>
      <div className="panel rules" style={{ marginTop: 14 }}>
        <p>Jouée dans le Perche Vendômois. Différence principale : <b>pas de retourne</b>.</p>
        <p>Le jeu se déroule <b>sans atout</b> jusqu'à ce qu'un joueur ayant <em>la main</em> annonce :</p>
        <ul>
          <li>À 2 joueurs : mariage, tierce ou quarteron → la couleur de l'annonce devient l'atout.</li>
          <li>À 3/4 joueurs : un mariage → la couleur du mariage devient l'atout.</li>
        </ul>
        <p>
          Le joueur <b>n'est pas obligé</b> de valider son annonce — la partie peut se
          dérouler entièrement sans atout. Une fois l'atout déclaré, le coup suit le
          processus de la Chouine classique.
        </p>
      </div>
    </div>
  );
}
