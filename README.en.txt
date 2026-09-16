Monitor PostNL parcels and available My Mail data in Homey. Includes a My PostNL
widget, automatic synchronization and Flow cards for new mail, new parcels,
status changes and synchronization errors.

Authentication uses the official PostNL sign-in page. First install the bundled
PostNL Homey Login Helper in Chrome. Then open the PostNL App Settings in Homey,
sign in and copy the automatically captured callback back to Homey. Neither the
Homey app nor the browser helper stores your password.

See the Homey Community forum topic for installing the helper:
https://community.homey.app/t/postnl-app-notification-when-post-letters-are-on-the-way/2662

PostNL does not provide a public consumer API. If a private My Mail endpoint
changes, the device remains available and parcel data continues to work; the app
will clearly indicate that My Mail is temporarily unavailable.
