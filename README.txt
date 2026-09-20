PostNL voor Homey

Bekijk je verwachte poststukken en PostNL-pakketten rechtstreeks in Homey. Elk Mijn PostNL-apparaat is gekoppeld aan één eigen PostNL-account. Daardoor kun je meerdere PostNL-accounts naast elkaar gebruiken, met per account eigen widgets, capabilities, Flow-kaarten en Flow-tokens.

Mogelijkheden
- Mijn Post-widget met de 10 meest recente poststukken en horizontaal scrollbare scans.
- Mijn Pakket-widget met de 5 meest recente pakketten en status Inkomend, Onderweg of Bezorgd.
- Device-afhankelijke Flow-triggers, conditions, actions en tokens.
- Lokale opslag van poststukscans (maximaal 21 dagen).
- Automatische synchronisatie iedere 5 minuten en extra controles rond middernacht.
- Privacyveilige diagnostiek: tokens, callbacks en autorisatiecodes worden nooit in logs getoond.
- Timeline-melding wanneer de credentials van een account verlopen en opnieuw koppelen nodig is.

PostNL-account koppelen
1. Download de PostNL Homey Login Helper via het Homey Community-topic van deze app.
2. Installeer de helper als Chrome-extensie zoals beschreven in het topic.
3. Ga in Homey naar Apparaat toevoegen → PostNL → Mijn PostNL.
4. Kies Open PostNL en meld je aan bij het PostNL-account dat je aan dit device wilt koppelen.
5. De helper vangt de postnl://login callback op. Kopieer de callback.
6. Plak de callback in het koppelvenster van Homey en kies Account koppelen.
7. Herhaal deze stappen om een tweede of volgend PostNL-account als apart device toe te voegen.

Opnieuw koppelen
Als PostNL de credentials intrekt of laat verlopen, wordt alleen het betreffende device geraakt. Homey plaatst één Timeline-melding met het verzoek dat account opnieuw te koppelen. Gebruik Repareren bij dat Mijn PostNL-device en doorloop opnieuw de PostNL-login. Andere PostNL-devices blijven gewoon functioneren.

De app gebruikt PostNL's persoonlijke, niet-publieke interfaces. Een wijziging in de PostNL-app of aanmeldprocedure kan daarom een app-update vereisen.
