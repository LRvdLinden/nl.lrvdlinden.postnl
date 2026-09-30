'use strict';

const ALIASES = {
  delivered: 'delivered', delivered_to_recipient: 'delivered', parcel_delivered: 'delivered', shipment_delivered: 'delivered', delivery_complete: 'delivered', completed: 'delivered', complete: 'delivered', concluded: 'delivered', pakket_is_bezorgd: 'delivered',
  in_delivery: 'transit', in_transit: 'transit', transit: 'transit', underway: 'transit', on_the_way: 'transit', shipped: 'transit', despatched: 'transit', dispatched: 'transit', in_depot: 'transit', left_depot: 'transit', handed_over: 'transit', pakket_is_onderweg: 'transit',
  out_for_delivery: 'out', outfordelivery: 'out', in_route: 'out',
  announced: 'announced', registered: 'announced', pre_transit: 'announced', data_received: 'announced', information_received: 'announced', tracking_code_created: 'announced', label_created: 'announced', created: 'announced', pakket_is_inkomend: 'announced',
  accepted: 'accepted', accepted_by_carrier: 'accepted', received_by_carrier: 'accepted', picked_up: 'picked', collected: 'picked',
  ready_for_pickup: 'ready', available_for_pickup: 'ready', at_pickup_point: 'ready', ready_for_collection: 'ready', ready_to_collect: 'ready',
  customs: 'customs', delivery_attempted: 'attempt', failed_attempt: 'attempt', delivery_attempt: 'attempt', delayed: 'delayed', delay: 'delayed', exception: 'exception', problem: 'exception', intervention: 'exception', error: 'exception',
  cancelled: 'cancelled', canceled: 'cancelled', returned: 'returned', return: 'returning', returning: 'returning', return_to_sender: 'returning', unknown: 'unknown',
};
function key(value=''){return String(value).trim().toLowerCase().replace(/[’'`]/g,'').replace(/[\s./\\-]+/g,'_').replace(/[^a-z0-9_]/g,'').replace(/_+/g,'_').replace(/^_|_$/g,'');}
function canonicalKey(raw){const n=key(raw);if(!n)return'';if(ALIASES[n])return ALIASES[n];if(/out.*for.*delivery|courier.*delivery|delivery.*courier/.test(n))return'out';if(/ready.*(pickup|pick_up|collect)|available.*(pickup|pick_up|collect)|pickup_point/.test(n))return'ready';if(/delivery.*attempt|attempt.*delivery/.test(n))return'attempt';if(/return.*sender|returning|return_in_transit/.test(n))return'returning';if(/returned|return_complete/.test(n))return'returned';if(/cancel/.test(n))return'cancelled';if(/delay/.test(n))return'delayed';if(/customs|douane|zoll|aduan|tull|told/.test(n))return'customs';if(/exception|problem|intervention|failed|failure/.test(n))return'exception';if(/delivered|delivery_complete|bezorgd|afgeleverd|zugestellt|livre|livree|consegnato|entregado/.test(n))return'delivered';if(/in_transit|on_the_way|underway|onderweg|shipped|despatched|dispatched|sorted|depot|hub|transport/.test(n))return'transit';if(/picked_up|collected|accepted_by|received_by_carrier/.test(n))return'picked';if(/announced|registered|aangemeld|inkomend|label|data_received|information_received|shipment_information|created/.test(n))return'announced';return'';}
function humanize(raw){return String(raw||'').trim().replace(/[_-]+/g,' ').replace(/\s+/g,' ').toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());}
function localizePackageStatus(homey,value){const raw=String(value??'').trim();if(!raw)return'';const canonical=canonicalKey(raw);if(canonical){const t=homey?.__?.(`package_status.${canonical}`);if(t&&t!==`package_status.${canonical}`)return t;}if(!/[_-]/.test(raw)&&raw!==raw.toUpperCase())return raw;return humanize(raw);}
localizePackageStatus.key=key;localizePackageStatus.canonicalKey=canonicalKey;localizePackageStatus.humanize=humanize;
module.exports=localizePackageStatus;
