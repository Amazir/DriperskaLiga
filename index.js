const express = require('express');
const sqlite3 = require('sqlite3').verbose();
var favicon = require('serve-favicon');
const util = require('util')
const path = require('path');

const app = express();
const db = new sqlite3.Database('./database.db');

app.set('view engine', 'ejs');

app.use(express.static(path.join(__dirname, 'assets')));

app.use(favicon(__dirname + '/assets/img/favicons/favicon.ico'));

let rankings = {
    totalKills: [],
    avgDamage: [],
    maxDeaths: [],
    bestKDA: [],
    maxCreeps: []
};

let gameStats = {
    kills: [],
    deaths: [],
    damage: []
};

let max = [];
max['kills'] = 0;
max['deaths'] = 0;
max['kda'] = 0;
max['damage'] = 0;
max['damageObj'] = 0;
max['creeps'] = 0;


function parsePlayerData(playerData, players) {
    const [id, champ, role, damage, kills, deaths, assists, minions, gold, lvl] = playerData.split(',');
    const player = players.find(p => p.id === parseInt(id)); // Find the player in the list by ID
    return {
        id: parseInt(id),
        champ,
        role,
        damage: parseInt(damage),
        kills: parseInt(kills),
        deaths: parseInt(deaths),
        assists: parseInt(assists),
        minions: parseInt(minions),
        gold: parseInt(gold),
        lvl: parseInt(lvl),
        KDA: ((parseInt(kills) + parseInt(assists)) / (parseInt(deaths) || 1)).toFixed(2),
        nickname: player ? player.nickname : 'Unknown',
        opgg: player ? player.opgg : '#',
    };
}

function getPlayerNicknameById(playerId) {
    return new Promise((resolve, reject) => {
        const query = 'SELECT nickname FROM players WHERE id = ?';
        db.get(query, [playerId], (err, row) => {
            if (err) {
                reject('Database error');
            } else {
                resolve(row ? row.nickname : 'Unknown');
            }
        });
    });
}

var normalized = function(val, type) {
    let maxValue;

    switch (type) {
        case "dmg": // Damage cap: 30,000
            maxValue = 30000;
            break;

        case "wr": // Win rate cap: 100%
            maxValue = 100;
            break;

        case "kills": // Kills cap: 15
            maxValue = 15;
            break;

        case "assists": // Assists cap: 15
            maxValue = 15;
            break;

        case "gold": // Gold cap: 15,000
            maxValue = 15000;
            break;

        case "creeps": // Creeps cap: 200
            maxValue = 200;
            break;

        default:
            return 0;
    }

    let score = (val / maxValue) * 10;

    return score;
};


app.get('/', (req, res) => {
    const playerQuery = 'SELECT * FROM players';
    const matchQuery = 'SELECT * FROM matches ORDER BY gamedate DESC';

    // Resetowanie rankingu przed każdym nowym zapytaniem
    rankings = {
        totalKills: [],
        avgDamage: [],
        avgGold: [],
        maxDeaths: [],
        bestKDA: [],
        maxCreeps: []
    };

    let gameStats = {
        kills: {},
        deaths: {},
        damage: {}
    };

    db.all(playerQuery, (err, players) => {
        if (err) {
            return res.status(500).send('Database error');
        }

        db.all(matchQuery, async (err, matches) => {
            if (err) {
                return res.status(500).send('Error fetching match history');
            }

            const processedPlayers = new Set(); // Zbiór do śledzenia przetworzonych graczy

            matches.forEach(match => {
                match.team0 = [];
                for (let i = 1; i <= 5; i++) {
                    const playerData = parsePlayerData(match[`team0player${i}`], players);
                    match.team0.push(playerData);

                    // Aktualizujemy najlepsze zabójstwa, jeśli obecny wynik jest wyższy
                    if (!gameStats.kills[playerData.nickname] || playerData.kills > gameStats.kills[playerData.nickname].value) {
                        gameStats.kills[playerData.nickname] = {
                            value: playerData.kills,
                            date: match.gamedate,
                            champion: playerData.champ
                        };
                    }

                    // Aktualizujemy najlepsze śmierci
                    if (!gameStats.deaths[playerData.nickname] || playerData.deaths > gameStats.deaths[playerData.nickname].value) {
                        gameStats.deaths[playerData.nickname] = {
                            value: playerData.deaths,
                            date: match.gamedate,
                            champion: playerData.champ
                        };
                    }

                    // Aktualizujemy najlepsze obrażenia
                    if (!gameStats.damage[playerData.nickname] || playerData.damage > gameStats.damage[playerData.nickname].value) {
                        gameStats.damage[playerData.nickname] = {
                            value: playerData.damage,
                            date: match.gamedate,
                            champion: playerData.champ
                        };
                    }
                }

                match.team1 = [];
                for (let i = 1; i <= 5; i++) {
                    const playerData = parsePlayerData(match[`team1player${i}`], players);
                    match.team1.push(playerData);

                    // Aktualizujemy najlepsze zabójstwa
                    if (!gameStats.kills[playerData.nickname] || playerData.kills > gameStats.kills[playerData.nickname].value) {
                        gameStats.kills[playerData.nickname] = {
                            value: playerData.kills,
                            date: match.gamedate,
                            champion: playerData.champ
                        };
                    }

                    // Aktualizujemy najlepsze śmierci
                    if (!gameStats.deaths[playerData.nickname] || playerData.deaths > gameStats.deaths[playerData.nickname].value) {
                        gameStats.deaths[playerData.nickname] = {
                            value: playerData.deaths,
                            date: match.gamedate,
                            champion: playerData.champ
                        };
                    }

                    // Aktualizujemy najlepsze obrażenia
                    if (!gameStats.damage[playerData.nickname] || playerData.damage > gameStats.damage[playerData.nickname].value) {
                        gameStats.damage[playerData.nickname] = {
                            value: playerData.damage,
                            date: match.gamedate,
                            champion: playerData.champ
                        };
                    }
                }
            });




            try {
                const playersData = await Promise.all(players.map(player => {
                    return new Promise((resolve, reject) => {
                        db.all('SELECT * FROM matches', async (err, matches) => {
                            if (err) reject(err);

                            const stats = await calculatePlayerStats(player.id, matches);

                            // Obliczenie rankingScore
                            const rankingScore =
                                normalized(stats.winRate * 0.30, "wr") +   // Winrate (30%)
                                normalized(stats.damage * 0.20, "dmg") +  // Damage (20%)
                                stats.totalGames * 0.20 + // Games played (10%)
                                normalized(stats.kills * 0.10, "kills") + // Kills per game (10%)
                                normalized(stats.assists * 0.10, "assists") + // Assists per game (10%)
                                normalized(stats.gold * 0.10, "gold") +  // Gold per game (10%)
                                normalized(stats.creeps * 0.10, "creeps"); // Creeps per game (10%)

                            const rankingScoreExplanation = [normalized(stats.winRate * 0.30, "wr"),
                                normalized(stats.winRate * 0.30, "wr"),
                                normalized(stats.damage * 0.20, "dmg"),
                                stats.totalGames * 0.20,
                                normalized(stats.kills * 0.10, "kills"),
                                normalized(stats.assists * 0.10, "assists"),
                                normalized(stats.gold * 0.10, "gold"),
                                normalized(stats.creeps * 0.10, "creeps")];

                            resolve({
                                player,
                                stats,
                                rankingScore,
                                rankingScoreExplanation,
                                lastMatch: matches.length > 0 ? matches[matches.length - 1].gamedate : 'N/A',
                            });
                        });
                    });
                }));

                playersData.sort((a, b) => {

                    if (a.rankingScore !== b.rankingScore) {
                        return b.rankingScore - a.rankingScore;
                    } else {
                        return b.stats.KDA - a.stats.KDA;
                    }
                });

                // Sortuj rankingi
                rankings.totalKills.sort((a, b) => b.value - a.value);
                rankings.avgDamage.sort((a, b) => b.value - a.value);
                rankings.avgGold.sort((a,b) => b.value - a.value);
                rankings.maxDeaths.sort((a, b) => b.value - a.value);
                rankings.bestKDA.sort((a, b) => b.value - a.value);
                rankings.maxCreeps.sort((a, b) => b.value - a.value);

                const sortedKills = Object.entries(gameStats.kills)
                    .map(([nickname, data]) => ({ nickname, ...data }))
                    .sort((a, b) => b.value - a.value);

                const sortedDeaths = Object.entries(gameStats.deaths)
                    .map(([nickname, data]) => ({ nickname, ...data }))
                    .sort((a, b) => b.value - a.value);

                const sortedDamage = Object.entries(gameStats.damage)
                    .map(([nickname, data]) => ({ nickname, ...data }))
                    .sort((a, b) => b.value - a.value);

                res.render('index', {
                    players: playersData,
                    matches,
                    max,
                    rankings,
                    sortedKills,
                    sortedDeaths,
                    sortedDamage
                });



            } catch (err) {
                res.status(500).send('Error loading data');
            }
        });
    });
});

function calculatePlayerStats(playerId, matches) {
    return new Promise(async (resolve, reject) => {
        let totalGames = 0;
        let totalWins = 0;
        let totalKills = 0;
        let totalDeaths = 0;
        let totalAssists = 0;
        let totalCreeps = 0;
        let totalDamage = 0;
        let totalGold = 0;

        const processedMatches = new Set();

        matches.forEach(match => {
            const teams = [0, 1]; // Team 0 and Team 1
            teams.forEach(team => {
                for (let i = 1; i <= 5; i++) {
                    const playerData = match[`team${team}player${i}`].split(',');
                    if (parseInt(playerData[0]) === playerId && !processedMatches.has(match.id)) {

                        processedMatches.add(match.id);

                        totalGames++;

                        if ((team === 0 && match.winner === 0) || (team === 1 && match.winner === 1)) {
                            totalWins++;
                        }

                        totalKills += parseInt(playerData[4]);  // Kills
                        totalDeaths += parseInt(playerData[5]); // Deaths
                        totalAssists += parseInt(playerData[6]); // Assists
                        totalCreeps += parseInt(playerData[7]);  // Creeps
                        totalDamage += parseInt(playerData[3]);  // Obrażenia
                        totalGold += parseInt(playerData[8]); // Gold
                    }
                }
            });
        });

        const winRate = (totalWins / totalGames) * 100 || 0;
        const KDA = (totalKills + totalAssists) / (totalDeaths || 1);
        const avgDamage = totalGames > 0 ? totalDamage / totalGames : 0;
        const avgGold = totalGames > 0 ? totalGold / totalGames : 0;

        try {
            const nickname = await getPlayerNicknameById(playerId); // Pobierz nazwę użytkownika z bazy danych

            // Aktualizowanie rankingów
            rankings.totalKills.push({ nickname, value: totalKills });
            rankings.avgDamage.push({ nickname, value: avgDamage.toFixed(2) });
            rankings.avgGold.push({ nickname, value: avgGold.toFixed(2) });
            rankings.maxDeaths.push({ nickname, value: totalDeaths });
            rankings.bestKDA.push({ nickname, value: KDA.toFixed(2) });
            rankings.maxCreeps.push({ nickname, value: totalCreeps });

            // Aktualizacja rekordów max
            if (KDA > max['kda']) max['kda'] = KDA;
            if (totalKills > max['kills']) max['kills'] = totalKills;
            if (totalCreeps > max['creeps']) max['creeps'] = totalCreeps;
            if (totalDeaths > max['deaths']) max['deaths'] = totalDeaths;

            resolve({
                totalGames,
                totalWins,
                winRate: winRate.toFixed(2),
                KDA: KDA.toFixed(2),
                damage: avgDamage,
                kills: totalGames > 0 ? totalKills / totalGames : 0,
                assists: totalGames > 0 ? totalAssists / totalGames : 0,
                gold: avgGold,
                creeps: totalGames > 0 ? totalCreeps / totalGames : 0,
                nickname: nickname
            });
        } catch (error) {
            reject('Error calculating player stats');
        }
    });
}



// Start the server
const PORT = process.env.PORT || 80;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
