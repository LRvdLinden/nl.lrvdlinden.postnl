PostNL for Homey

Bekijk verwachte poststukken en PostNL-pakketten in Homey. De app gebruikt de
persoonlijke, niet-openbare PostNL-interface en kan daardoor veranderen wanneer
PostNL zijn mobiele app of aanmeldprocedure wijzigt.

Koppelen
1. Download en pak de PostNL Homey Login Helper uit.
2. Open chrome://extensions, schakel Ontwikkelaarsmodus in en kies
   Uitgepakte extensie laden.
3. Open Meer → Apps → PostNL → Instellingen.
4. Kies Open PostNL en meld je aan op de beveiligde PostNL-pagina.
5. De helper vangt de callback automatisch op. Kopieer deze naar de
   App-instellingen en voltooi de aanmelding.
6. Voeg daarna het apparaat Mijn PostNL toe.

De Homey-app en browserhelper slaan je PostNL-wachtwoord niet op. Deel callbacks
en tokens nooit met anderen.

De app controleert dagelijks automatisch de actuele PostNL iOS-appversie,
haalt iedere vijf minuten nieuwe gegevens op en controleert rond
middernacht extra vaak op nieuwe Mijn Post-items. Briefgegevens en afbeeldingen
worden maximaal 21 dagen lokaal in Homey bewaard.

PostNL biedt geen openbare consumenten-API. Wanneer een niet-openbaar Mijn
Post-endpoint verandert, blijft Mijn PostNL beschikbaar en blijven pakketten
werken. De status en widget melden dan dat Mijn Post tijdelijk niet beschikbaar
is, in plaats van het volledige apparaat onbeschikbaar te maken.
