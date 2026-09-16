# PostNL Homey Login Helper

Deze Chrome-extensie onderschept de `postnl://login` OAuth-callback van PostNL en toont hem op een lokale extensiepagina. Plak de callback daarna in de PostNL App Settings van Homey.

Versie 1.2.2 gebruikt exact het PostNL `icon.svg` van de Homey-app als bron voor het extensie-icoon. De Chrome werkbalk-, extensielijst- en popup-iconen zijn hiervan afgeleid en ook de callbackpagina toont hetzelfde PostNL-logo.

## Installeren in Chrome

1. Pak `PostNL-Homey-Login-Helper-v1.2.2.zip` uit.
2. Open `chrome://extensions`.
3. Schakel rechtsboven **Ontwikkelaarsmodus** in.
4. Kies **Uitgepakte extensie laden**.
5. Selecteer de uitgepakte map.

## Gebruiken

1. Open Homey en ga naar **Apps → PostNL → Instellingen**.
2. Kies **Open PostNL** en log in.
3. De helper opent automatisch zodra PostNL naar `postnl://login` doorstuurt.
4. Kies **Callback kopiëren**.
5. Plak de callback in Homey en voltooi de aanmelding.

Opent de callbackpagina niet automatisch, klik dan rechtsboven in Chrome op het extensie-icoon. De laatst onderschepte callback kan daar alsnog worden gekopieerd.

De extensie leest uitsluitend redirects vanaf `*.postnl.nl`. De callback blijft lokaal in Chrome en wordt nergens geüpload.
