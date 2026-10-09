'use strict';
const localizePackageStatus = require('../../lib/status-i18n');
function timestamp(item){const value=item?.deliveryDate||item?.deliveryWindowFrom||item?.updatedAt||item?.createdAt||0;const time=Date.parse(value);return Number.isFinite(time)?time:0;}
function str(...values){for(const value of values){if(value===0)return'0';if(value!==undefined&&value!==null&&String(value).trim())return String(value).trim();}return'';}
function shipmentType(homey,value){const raw=str(value);if(!raw)return'';return homey.i18n.getLanguage()==='nl'&&/^parcel$/i.test(raw)?'Pakket':raw;}
function getDevice(homey,id){const device=homey.drivers.getDriver('account').getDevices().find(d=>d.getId()===id);if(!device)throw new Error('PostNL device not found.');return device;}
module.exports={
 async getData({homey,query}){
  const device=getDevice(homey,query?.deviceId);const data=device.getWidgetData();
  const packages=(data.packages||[]).map(parcel=>({
   carrier:'PostNL',carrierLogo:'icon.svg',account:device.getName(),tracking:str(parcel.barcode,parcel.id),status:str(parcel.statusRaw,parcel.latestStatusEvent,parcel.status,localizePackageStatus(homey,parcel.status||'')),
   sender:str(parcel.sender,parcel.title,parcel.sourceDisplayName),receiver:str(parcel.receiver),deliveryDate:str(parcel.deliveryDate,parcel.deliveryWindowFrom),deliveryWindow:str(parcel.deliveryWindow),deliveryWindowFrom:str(parcel.deliveryWindowFrom),deliveryWindowTo:str(parcel.deliveryWindowTo),
   updatedAt:str(parcel.updatedAt,parcel.createdAt),createdAt:str(parcel.createdAt),eventAt:str(parcel.lastEventAt,parcel.eventAt,parcel.delivered?parcel.deliveryDate:'',parcel.updatedAt,parcel.createdAt),lastEventAt:str(parcel.lastEventAt,parcel.eventAt,parcel.delivered?parcel.deliveryDate:'',parcel.updatedAt,parcel.createdAt),lastEvent:str(parcel.latestStatusEvent,parcel.lastEvent,parcel.statusRaw,parcel.status),
   shipmentType:shipmentType(homey,parcel.shipmentType),deliveryAddressType:str(parcel.deliveryAddressType),direction:str(parcel.direction),sharedFrom:str(parcel.sourceDisplayName),sourceAccountId:str(parcel.sourceAccountId),title:str(parcel.title),detailsUrl:str(parcel.detailsUrl),delivered:Boolean(parcel.delivered),
   statusChangedAt:str(parcel.statusChangedAt),statusCode:str(parcel.statusCode),deliveryWindowType:str(parcel.deliveryWindowType),deliveredAt:str(parcel.deliveredTimeStamp),
   canonicalStatus:str(parcel.canonicalStatus),observationCode:str(parcel.observationCode),
   weight:str(parcel.weight),weightKg:Number.isFinite(Number(parcel.weightKg))&&parcel.weightKg!==null?Number(parcel.weightKg):null,dimensions:str(parcel.dimensions),
   lengthCm:Number.isFinite(Number(parcel.dimensionLengthCm))&&parcel.dimensionLengthCm!==null?Number(parcel.dimensionLengthCm):null,widthCm:Number.isFinite(Number(parcel.dimensionWidthCm))&&parcel.dimensionWidthCm!==null?Number(parcel.dimensionWidthCm):null,heightCm:Number.isFinite(Number(parcel.dimensionHeightCm))&&parcel.dimensionHeightCm!==null?Number(parcel.dimensionHeightCm):null,
   pickup:Boolean(parcel.pickup),pickupPoint:str(parcel.pickupPoint),
   events:(Array.isArray(parcel.statusEvents)?parcel.statusEvents:[]).filter(e=>e&&(e.description||e.timestamp)).slice(-12).reverse().map(e=>({description:str(e.description),timestamp:str(e.timestamp),location:str(e.location)}))
  })).sort((a,b)=>timestamp(b)-timestamp(a)).slice(0,5);
  return{authenticated:data.authenticated,packages,locale:homey.i18n.getLanguage(),timeZone:homey.clock.getTimezone()};
 },
 async sync({homey,body}){await getDevice(homey,body?.deviceId).sync({reason:'widget',force:true});return{ok:true};}
};
