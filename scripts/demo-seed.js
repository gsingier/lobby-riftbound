'use strict';

// Remplit une base de démonstration : tables occupées avec des timers variés et une file d'attente.
// Usage : DATA_DIR=./data-demo node scripts/demo-seed.js   puis   DATA_DIR=./data-demo npm start

const path = require('path');
const { openDb } = require('../server/db');
const { Lobby } = require('../server/lobby');

const FIRST = ['Lucas', 'Emma', 'Hugo', 'Léa', 'Nathan', 'Chloé', 'Théo', 'Manon', 'Louis', 'Camille', 'Jules',
  'Inès', 'Gabriel', 'Sarah', 'Arthur', 'Zoé', 'Raphaël', 'Jade', 'Maël', 'Louise', 'Noah', 'Alice', 'Adam',
  'Lina', 'Ethan', 'Rose', 'Timéo', 'Anna', 'Sacha', 'Eva', 'Mathis', 'Nina', 'Enzo', 'Lou', 'Tom', 'Mila',
  'Paul', 'Romane', 'Axel', 'Julia', 'Maxime', 'Clara', 'Victor', 'Margaux', 'Antoine', 'Agathe'];
const LAST = ['Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand', 'Leroy', 'Moreau',
  'Simon', 'Laurent', 'Lefèvre', 'Michel', 'Garcia', 'David', 'Bertrand', 'Roux', 'Vincent', 'Fournier'];

const dbFile = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'lobby.db');
const db = openDb(dbFile);
let clock = Date.now() - 58 * 60 * 1000;
const lobby = new Lobby(db, { now: () => clock });

let i = 0;
const player = () => {
  const n = i++;
  return {
    firstName: FIRST[n % FIRST.length],
    lastName: LAST[(n * 7) % LAST.length],
    email: `demo${n}-${Date.now()}@exemple.fr`,
    ticket: `PGW-${Date.now()}-${n}`,
  };
};

const pairs = Number(process.env.SEED_PAIRS || 17);
for (let k = 0; k < pairs; k++) {
  lobby.register([player(), player()]);
  clock += 3 * 60 * 1000 + Math.round(Math.random() * 60 * 1000);
}
clock = Date.now();
lobby.register([player()]); // joueur seul qui attend un partenaire
for (let k = 0; k < Number(process.env.SEED_QUEUE || 6); k++) lobby.register([player(), player()]);
console.log(`Base de démo prête : ${dbFile}`);
db.close();
