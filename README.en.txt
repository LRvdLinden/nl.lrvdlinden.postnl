PostNL for Homey

PostNL for Homey brings expected mail items and PostNL parcels into Homey. You get current device statuses, Dashboard widgets and extensive Flow cards for automations.

What can the app do?
• See whether mail is expected and how many mail items are known.
• View scans/images of mail items when PostNL provides them.
• Use the My Post widget: up to 5 recent mail items in a horizontal swipe/scroll view. Tap a scan to enlarge it.
• Use the My Package widget: up to 5 recent parcels, including delivered shipments, with a clear Incoming, In transit or Delivered status.
• View parcel details such as sender, barcode, delivery date/window and tracking link when PostNL provides that information.
• Use Flow triggers for new mail, new parcels, parcel status changes, sync errors and expired logins.
• Flow cards expose extensive tags/tokens. New mail can also include a Homey image token.
• The PostNL device also publishes the latest mail scan as a Homey camera image when available.

Connecting PostNL
PostNL sign-in is completed from App Settings. The PostNL Homey Login Helper for Google Chrome is required. The helper can be downloaded from the official Homey Community topic:
https://community.homey.app/t/app-pro-postnl-for-homey/159674

1. Download the PostNL Homey Login Helper from the Community topic and extract the ZIP.
2. Open chrome://extensions in Chrome.
3. Enable Developer mode and choose Load unpacked.
4. Select the extracted PostNL Homey Login Helper folder.
5. In Homey go to More → Apps → PostNL → Settings.
6. Choose Open PostNL and sign in to PostNL.
7. The Chrome helper intercepts the postnl://login callback. Choose Copy callback.
8. Paste the callback into the PostNL App Settings in Homey and complete sign-in.
9. Then add the My PostNL device.

The browser helper only intercepts the OAuth callback and does not store your PostNL password. The callback is temporary and single-use; do not share it with others.

Synchronization and storage
The app synchronizes every 5 minutes by default and performs additional checks around midnight for new My Post items. Mail item data and available images are stored locally in Homey so recent mail can remain visible. Parcel data remains available to the widget so recently delivered parcels can also be shown.

Please note
PostNL does not provide a public consumer API for these features. This app uses the same non-public interfaces used by PostNL's mobile services. If PostNL changes those interfaces, a feature may temporarily become unavailable. Parcel data and My Post are handled independently where possible, so a My Post issue does not automatically disable the entire device.

Developer: https://lrvdlinden.app
Support: homey@vdlinden.xyz
Community: https://community.homey.app/t/app-pro-postnl-for-homey/159674
