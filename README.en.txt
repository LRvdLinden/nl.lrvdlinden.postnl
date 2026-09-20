PostNL for Homey

View expected mail items and PostNL parcels directly in Homey. Every My PostNL device is connected to its own PostNL account, so multiple accounts can be used side by side with separate widgets, capabilities, Flow cards and Flow tokens.

Features
- My Post widget with the 10 most recent mail items and horizontally scrollable scans.
- My Package widget with the 5 most recent parcels and Incoming, In transit or Delivered status.
- Device-dependent Flow triggers, conditions, actions and tokens.
- Local archive of mail scans for up to 21 days.
- Automatic synchronization every 5 minutes plus additional checks around midnight.
- Privacy-safe diagnostics: tokens, callbacks and authorization codes are never shown in logs.
- Timeline notification when an account's credentials expire and reconnection is required.

Connect a PostNL account
1. Download the PostNL Homey Login Helper from this app's Homey Community topic.
2. Install the helper as a Chrome extension as described in the topic.
3. In Homey, go to Add Device → PostNL → My PostNL.
4. Choose Open PostNL and sign in to the PostNL account you want to connect to this device.
5. The helper captures the postnl://login callback. Copy the callback.
6. Paste the callback in Homey's pairing screen and choose Connect account.
7. Repeat these steps to add another PostNL account as a separate device.

Reconnect an account
If PostNL revokes or expires the credentials, only the affected device is impacted. Homey creates one Timeline notification asking you to reconnect that account. Use Repair on the affected My PostNL device and complete the PostNL sign-in again. Other PostNL devices continue to work.

The app uses PostNL's personal, non-public interfaces. Changes to PostNL's mobile app or sign-in procedure can therefore require an app update.
