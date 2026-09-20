'use strict';
function timestamp(item){const t=new Date(item?.deliveryDate||item?.archivedAt||0).getTime();return Number.isFinite(t)?t:0;}
function getDevice(homey,id){const device=homey.drivers.getDriver('account').getDevices().find(d=>d.getId()===id);if(!device)throw new Error('PostNL device not found.');return device;}
module.exports={
 async getData({homey,query}){const device=getDevice(homey,query?.deviceId);const data=device.getWidgetData();return{authenticated:data.authenticated,mailApiStatus:data.mailApiStatus,mailApiError:data.mailApiError,letters:[...(data.letters||[])].sort((a,b)=>timestamp(b)-timestamp(a)).slice(0,10),locale:homey.i18n.getLanguage(),timeZone:homey.clock.getTimezone()};},
 async sync({homey,body}){await getDevice(homey,body?.deviceId).sync({reason:'widget',force:true});return{ok:true};}
};
