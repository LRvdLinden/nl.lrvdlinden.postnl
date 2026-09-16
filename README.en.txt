Monitor PostNL parcels and available My PostNL data in Homey. Includes a My PostNL
widget, automatic synchronization and Flow cards for new mail, new parcels,
status changes and synchronization errors.

Authentication uses the official PostNL sign-in page. First install the bundled
PostNL Homey Login Helper in Chrome. Then open the PostNL App Settings in Homey,
sign in and copy the automatically captured callback back to Homey. Neither the
Homey app nor the browser helper stores your password.

PostNL does not provide a public consumer API. If a private My PostNL endpoint
changes, the device remains available and parcel data continues to work; the app
will clearly indicate that My PostNL is temporarily unavailable.
