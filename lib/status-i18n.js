'use strict';

// Carrier APIs expose a mix of machine codes (IN_DELIVERY), English labels
// and already-localized text. Keep one app-wide normalizer so capabilities,
// Flow tokens and widgets all present the same readable status.
const ALIASES = {
  // Delivered
  delivered: 'delivered',
  delivered_to_recipient: 'delivered',
  parcel_delivered: 'delivered',
  shipment_delivered: 'delivered',
  delivery_complete: 'delivered',
  completed: 'delivered',
  complete: 'delivered',
  concluded: 'delivered',

  // In transit / underway
  in_delivery: 'transit', // DHL eCommerce category: parcel is in transit
  in_transit: 'transit',
  transit: 'transit',
  underway: 'transit',
  on_the_way: 'transit',
  shipped: 'transit',
  despatched: 'transit',
  dispatched: 'transit',
  in_depot: 'transit',
  left_depot: 'transit',
  hand_over: 'transit',
  handed_over: 'transit',
  parcel_sorted_at_hub: 'transit',
  parcel_arrived_at_local_depot: 'transit',
  depart_facility: 'transit',
  forward_destination: 'transit',

  // Out for delivery
  out_for_delivery: 'out',
  outfordelivery: 'out',
  in_route: 'out',
  delivery_planned_in_route: 'out',
  parcel_scanned_into_hand_terminal: 'out',
  parcel_handed_over_to_courier: 'out',

  // Announced / registered
  announced: 'announced',
  registered: 'announced',
  pre_transit: 'announced',
  data_received: 'announced',
  leg: 'announced',
  information_received: 'announced',
  information_on_delivery_transmitted: 'announced',
  shipment_information_received: 'announced',
  shipment_information_sent_to_fedex: 'announced',
  electronic_notification_received: 'announced',
  tracking_code_created: 'announced',
  label_created: 'announced',
  created: 'announced',

  // Accepted / picked up
  accepted: 'accepted',
  accepted_by_carrier: 'accepted',
  received_by_carrier: 'accepted',
  picked_up: 'picked',
  collected: 'picked',

  // Ready for pickup
  ready_for_pickup: 'ready',
  available_for_pickup: 'ready',
  at_pickup_point: 'ready',
  ready_for_collection: 'ready',
  ready_for_collection_at_merchant: 'ready',
  ready_to_collect: 'ready',

  // Customs
  customs: 'customs',

  // Delivery attempt / delay / exceptions
  delivery_attempted: 'attempt',
  failed_attempt: 'attempt',
  delivery_attempt: 'attempt',
  delayed: 'delayed',
  delay: 'delayed',
  exception: 'exception',
  problem: 'exception',
  intervention: 'exception',
  error: 'exception',

  // Returns / cancellation
  cancelled: 'cancelled',
  canceled: 'cancelled',
  returned: 'returned',
  return: 'returning',
  returning: 'returning',
  return_to_sender: 'returning',

  unknown: 'unknown',
};

function key(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/[\s./\\-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function canonicalKey(raw) {
  const normalized = key(raw);
  if (!normalized) return '';
  if (ALIASES[normalized]) return ALIASES[normalized];

  // Conservative phrase matching for human-readable carrier statuses.
  if (/out.*for.*delivery|courier.*delivery|delivery.*courier/.test(normalized)) return 'out';
  if (/ready.*(pickup|pick_up|collect)|available.*(pickup|pick_up|collect)|pickup_point/.test(normalized)) return 'ready';
  if (/delivery.*attempt|attempt.*delivery/.test(normalized)) return 'attempt';
  if (/return.*sender|returning|return_in_transit/.test(normalized)) return 'returning';
  if (/returned|return_complete/.test(normalized)) return 'returned';
  if (/cancel/.test(normalized)) return 'cancelled';
  if (/delay/.test(normalized)) return 'delayed';
  if (/customs|douane|zoll|aduan|tull|told/.test(normalized)) return 'customs';
  if (/exception|problem|intervention|failed|failure/.test(normalized)) return 'exception';
  if (/delivered|delivery_complete|bezorgd|afgeleverd|zugestellt|livre|livree|consegnato|entregado/.test(normalized)) return 'delivered';
  if (/in_transit|on_the_way|underway|shipped|despatched|dispatched|sorted|depot|hub|transport/.test(normalized)) return 'transit';
  if (/picked_up|collected|accepted_by|received_by_carrier/.test(normalized)) return 'picked';
  if (/announced|registered|label|data_received|information_received|shipment_information|created/.test(normalized)) return 'announced';

  return '';
}

function humanize(raw) {
  return String(raw || '')
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, char => char.toUpperCase());
}

function localizePackageStatus(homey, value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  const canonical = canonicalKey(raw);
  if (canonical) {
    const translated = homey?.__?.(`package_status.${canonical}`);
    if (translated && translated !== `package_status.${canonical}`) return translated;
  }

  // Keep already human-readable/localized text intact, but never leak machine
  // codes such as FOO_BAR or FOO-BAR into the UI.
  if (!/[_-]/.test(raw) && raw !== raw.toUpperCase()) return raw;
  return humanize(raw);
}

localizePackageStatus.key = key;
localizePackageStatus.canonicalKey = canonicalKey;
localizePackageStatus.humanize = humanize;

module.exports = localizePackageStatus;
