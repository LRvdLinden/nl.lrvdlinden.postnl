# PostNL Homey Login Helper

Deze Chrome-extensie onderschept de `postnl://login` OAuth-callback van PostNL en toont hem op een lokale extensiepagina. Plak de callback daarna in de PostNL App Settings van Homey.

Versie 1.2.1 gebruikt het PostNL-app-logo in de Chrome-extensielijst, werkbalk en popup en toont geen interne OAuth-identificatiegegevens in de documentatie.

## Installeren in Chrome

1. Pak `PostNL-Homey-Login-Helper.zip` uit.
2. Open `chrome://extensions`.
3. Schakel rechtsboven **Ontwikkelaarsmodus** in.
4. Kies **Uitgepakte extensie laden**.
5. Selecteer de uitgepakte map `PostNL-Homey-Login-Helper`.

## Gebruiken

1. Open Homey en ga naar **Apps → PostNL → Instellingen**.
2. Kies **Open PostNL** en log in.
3. De helper opent automatisch zodra PostNL naar `postnl://login` doorstuurt.
4. Kies **Callback kopiëren**.
5. Plak de callback in Homey en voltooi de aanmelding.

Opent de callbackpagina niet automatisch, klik dan rechtsboven in Chrome op het extensie-icoon en open **PostNL Homey Login Helper**. De laatst onderschepte callback kan daar alsnog worden gekopieerd. Staat daar nog geen callback, sluit dan alle gewone PostNL-tabbladen en start de aanmelding opnieuw vanuit de PostNL App Settings in Homey.

De extensie leest uitsluitend redirects vanaf `*.postnl.nl`. De callback blijft lokaal in Chrome en wordt nergens geüpload.
