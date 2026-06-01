export default function Rules() {
  return (
    <div className="wrap" style={{ padding: '36px 0 60px' }}>
      <h2 className="section-title">Les règles de la Chouine</h2>
      <p className="section-sub">Version classique, telle que pratiquée dans la Vallée du Loir.</p>

      <div className="panel rules">
        <div className="rules-cols">
          <h3>Le matériel</h3>
          <p>Un jeu de 32 cartes (7, 8, 9, 10, Valet, Dame, Roi, As) dans les quatre couleurs : ♠ pique, ♥ cœur, ♦ carreau, ♣ trèfle.</p>
          <h3>Ordre &amp; valeur des cartes</h3>
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
          <p>Les <b>As</b> et les <b>Dix</b> sont les <b>brisques</b> — les cartes qui font les points.</p>
          <h3>La donne &amp; l'atout</h3>
          <p>5 cartes chacun. La 11ᵉ carte retournée fixe l'<b>atout</b>. Le reste forme le talon. Le joueur qui possède le <b>7 d'atout</b> peut l'échanger contre la retourne.</p>
          <h3>Le déroulement</h3>
          <p><b>Talon présent :</b> on joue librement. Le gagnant du pli pioche en premier.</p>
          <p><b>Talon épuisé :</b> fournir à la couleur, <b>monter</b> si l'atout est demandé, <b>couper</b> si l'on n'a pas la couleur.</p>
          <h3>Les annonces (2 joueurs)</h3>
          <p>Déclarées par le joueur ayant <em>la main</em> (a remporté le pli précédent). À l'atout, les trois premières valent double.</p>
          <table>
            <tbody>
              <tr><td>Mariage (R + D)</td><td>20 / 40</td></tr>
              <tr><td>Tierce (R + D + V)</td><td>30 / 60</td></tr>
              <tr><td>Quarteron (A + R + D + V)</td><td>40 / 80</td></tr>
              <tr><td>Quinte (5 brisques en main)</td><td>50</td></tr>
              <tr><td>Chouine (A + 10 + R + D + V)</td><td>gagne le coup</td></tr>
            </tbody>
          </table>
          <h3>Le décompte du coup</h3>
          <p>Points des plis + annonces + <b>10 pts dix de der</b> (dernier pli). Le plus haut total remporte 1 point. <b>Égalité = coup nul</b>, même donneur.</p>
          <h3>La victoire</h3>
          <p>On joue en 3 ou 5 points. Premier au total convenu gagne le match. Une <b>chouine</b> (A, 10, R, D, V même couleur) gagne immédiatement.</p>
        </div>
      </div>

      <h2 className="section-title" style={{ marginTop: 36 }}>La Chouine à 3 ou 4 joueurs</h2>
      <div className="panel rules" style={{ marginTop: 14 }}>
        <p>Les règles à deux s'appliquent, sauf :</p>
        <ul>
          <li><b>3 cartes</b> chacun. Retourne = 10ᵉ carte (3J) ou 13ᵉ (4J).</li>
          <li>À 3 joueurs, les <b>2 dernières cartes</b> du talon ne sont pas tirées.</li>
          <li>Chaque gagnant de pli tire en premier, puis les autres dans l'ordre.</li>
          <li>C'est le joueur avec le <b>plus grand total de points</b> qui remporte le coup. Égalité → coup nul.</li>
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

      <h2 className="section-title" style={{ marginTop: 36 }}>La Chouine de Mondoubleau</h2>
      <div className="panel rules" style={{ marginTop: 14 }}>
        <p>Jouée dans le Perche Vendômois. Différence principale : <b>pas de retourne</b>.</p>
        <p>Le jeu se déroule <b>sans atout</b> jusqu'à ce qu'un joueur ayant <em>la main</em> annonce :</p>
        <ul>
          <li>À 2J : mariage, tierce ou quarteron → la couleur de l'annonce devient l'atout.</li>
          <li>À 3/4J : un mariage → la couleur du mariage devient l'atout.</li>
        </ul>
        <p>Le joueur <b>n'est pas obligé</b> de valider son annonce. La partie peut se dérouler entièrement sans atout.</p>
        <p>Une fois l'atout déclaré, la partie suit le processus de la Chouine classique.</p>
      </div>
    </div>
  );
}
