// Weather for the first trip day from Open-Meteo (no key needed; only the village's coordinates are sent).
// Up to 15 days ahead: the forecast. Further out: what the weather was on the same day last year.
const placeCoords={Serfaus:[47.0408,10.6061],Fiss:[47.0562,10.6174],Ladis:[47.0744,10.6494]};
const weatherIcons={sun:'☀',partly:'⛅',cloud:'☁',fog:'🌫',rain:'🌧',snow:'❄',storm:'⛈'};
function weatherKind(code){
  if(code<=1) return 'sun';
  if(code===2) return 'partly';
  if(code===3) return 'cloud';
  if(code===45||code===48) return 'fog';
  if(code>=95) return 'storm';
  if(code>=71&&code<=77||code===85||code===86) return 'snow';
  return 'rain';
}
async function fetchWeather(place,date){
  const [latitude,longitude]=placeCoords[place];
  const ahead=(Date.parse(date)-Date.parse(todayDate()))/864e5;
  let url='https://api.open-meteo.com/v1/forecast', source='forecast', day=date;
  if(ahead>15){
    url='https://archive-api.open-meteo.com/v1/archive';
    source='lastYear';
    let year=Number(date.slice(0,4))-1;
    const monthDay=date.slice(5)==='02-29'?'02-28':date.slice(5);
    while(`${year}-${monthDay}`>=todayDate()) year--;
    day=`${year}-${monthDay}`;
  }
  const params=new URLSearchParams({latitude,longitude,daily:'weather_code,temperature_2m_max,temperature_2m_min',
    timezone:'Europe/Vienna',start_date:day,end_date:day});
  const response=await fetch(`${url}?${params}`);
  if(!response.ok) throw Error('Weather unavailable');
  const {daily}=await response.json();
  const code=daily?.weather_code?.[0];
  if(code==null) throw Error('No weather data');
  return {kind:weatherKind(code),tmax:Math.round(daily.temperature_2m_max[0]),tmin:Math.round(daily.temperature_2m_min[0]),
    source,year:Number(day.slice(0,4))};
}
