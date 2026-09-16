PostNL voor Homey

Met PostNL voor Homey haal je jouw verwachte poststukken en PostNL-pakketten naar Homey. Je krijgt actuele apparaatstatussen, Dashboard-widgets en uitgebreide Flow-kaarten voor automatiseringen.

Wat kan de app?
• Bekijk of er post wordt verwacht en hoeveel poststukken bekend zijn.
• Bekijk scans/afbeeldingen van poststukken zodra PostNL deze beschikbaar stelt.
• Gebruik de widget Mijn Post: maximaal 5 recente poststukken in een horizontaal swipe-/scrolloverzicht. Tik op een scan om deze groot te bekijken.
• Gebruik de widget Mijn Pakket: maximaal 5 recente pakketten, inclusief bezorgde zendingen, met een duidelijke status Inkomend, Onderweg of Bezorgd.
• Bekijk pakketdetails zoals afzender, barcode, bezorgdatum/-venster en trackinglink wanneer PostNL die gegevens levert.
• Gebruik Flow-triggers voor nieuwe post, nieuwe pakketten, pakketstatuswijzigingen, synchronisatiefouten en verlopen aanmeldingen.
• Flow-kaarten bevatten uitgebreide tags/tokens. Nieuwe post kan daarnaast een Homey-afbeeldingstoken bevatten.
• Het PostNL-device publiceert de laatste postscan ook als Homey camera-afbeelding wanneer een afbeelding beschikbaar is.

PostNL koppelen
De PostNL-aanmelding verloopt via App-instellingen. Hiervoor is de PostNL Homey Login Helper voor Google Chrome nodig. De helper is te downloaden via het officiële Homey Community-topic:
https://community.homey.app/t/app-pro-postnl-for-homey/159674

1. Download de PostNL Homey Login Helper via het Community-topic en pak de ZIP uit.
2. Open in Chrome chrome://extensions.
3. Schakel Ontwikkelaarsmodus in en kies Uitgepakte extensie laden.
4. Selecteer de uitgepakte map van de PostNL Homey Login Helper.
5. Ga in Homey naar Meer → Apps → PostNL → Instellingen.
6. Kies Open PostNL en meld je aan bij PostNL.
7. De Chrome-helper vangt de postnl://login-callback op. Kies Callback kopiëren.
8. Plak de callback in de PostNL App-instellingen van Homey en voltooi de aanmelding.
9. Voeg daarna het apparaat Mijn PostNL toe.

De browserhelper onderschept alleen de OAuth-callback en slaat je PostNL-wachtwoord niet op. De callback is tijdelijk en eenmalig geldig; deel deze niet met anderen.

Synchronisatie en opslag
De app synchroniseert standaard iedere 5 minuten en controleert rond middernacht extra op nieuwe Mijn Post-items. Poststukgegevens en beschikbare afbeeldingen worden lokaal in Homey bewaard zodat recente post zichtbaar kan blijven. Pakketgegevens blijven beschikbaar voor de widget zodat ook recent bezorgde pakketten kunnen worden getoond.

Let op
PostNL biedt geen openbare consumenten-API voor deze functies. Deze app gebruikt dezelfde niet-openbare interfaces als de mobiele PostNL-diensten. Wanneer PostNL die interfaces wijzigt, kan een onderdeel tijdelijk niet beschikbaar zijn. Pakketgegevens en Mijn Post worden waar mogelijk onafhankelijk van elkaar verwerkt, zodat een probleem met Mijn Post niet automatisch het volledige device uitschakelt.

