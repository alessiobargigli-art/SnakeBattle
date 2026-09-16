# SnakeBattle

SnakeBattle è un gioco web realtime semplice e adatto ai bambini, pensato soprattutto per smartphone in landscape.

## Prima versione

- 1 vs CPU
- 1 vs 1 online con codice stanza
- link stanza condivisibile con `?room=CODICE`
- campo largo 16:9 ottimizzato per cellulare landscape
- controlli swipe, frecce/WASD e D-pad touch
- serpenti disegnati su Canvas con corpo morbido, squame, occhi e lingua biforcuta
- frutta che fa crescere il serpente
- collisioni con muri, sé stessi e avversario
- round automatici e punteggio
- tre velocità di gioco
- piccoli effetti sonori sintetizzati nel browser

## Architettura

Come MattPong, il progetto è Cloudflare-native:

- Cloudflare Worker
- Durable Object per ogni stanza
- WebSocket realtime
- static assets serviti dallo stesso Worker
- nessun database e nessuna autenticazione

## Sviluppo

```bash
npm install
npm run check
npm run dev
```

## Deploy Cloudflare

- Build command: `npm run check`
- Deploy command: `npx wrangler deploy`
- Root directory: repository root

Il nome Worker configurato è `snakebattle`.
