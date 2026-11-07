export const guestCards={
  sfl:{name:'Super. Sommer. Card.',start:'06-12',end:'10-17',source:'https://www.serfaus-fiss-ladis.at/de/sommerurlaub/super-sommer-card'},
  saalfelden:{name:'Saalfelden Leogang Card',source:'https://www.saalfelden-leogang.com/de/region-erleben/saalfelden-leogang-card'},
  zell:{name:'Zell am See-Kaprun Sommerkarte',start:'05-15',end:'10-31',source:'https://www.zellamsee-kaprun.com/de/erleben/sommerkarte/partner-attraktionen'},
  nationalpark:{name:'Nationalpark SommerCard',start:'05-01',end:'10-31',dailyLimit:1,source:'https://www.nationalpark-sommercard.at/de/service/faqs-sommercard'},
  salzburg:{name:'Salzburg Card (Kaufkarte)',source:'https://www.salzburg.info/de/hotels-angebote/salzburg-card'}
};

export function passBenefit(activity,key,date){
  const card=guestCards[key];
  if (!card || !date) return null;
  const monthDay=date.slice(5);
  if (card.start && (monthDay<card.start || monthDay>card.end)) return null;
  return activity.passes?.find(rule=>rule.card===key && (!rule.from||rule.from<=date) && (!rule.to||date<=rule.to)) || null;
}
