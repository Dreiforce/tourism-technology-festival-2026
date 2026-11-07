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
function lastYearDay(date){
  let year=Number(date.slice(0,4))-1;
  const monthDay=date.slice(5)==='02-29'?'02-28':date.slice(5);
  while(`${year}-${monthDay}`>=todayDate()) year--;
  return `${year}-${monthDay}`;
}
async function dailyWeather(url,place,days,source){
  const [latitude,longitude]=placeCoords[place];
  const sorted=[...days].sort();
  const params=new URLSearchParams({latitude,longitude,daily:'weather_code,temperature_2m_max,temperature_2m_min',
    timezone:'Europe/Vienna',start_date:sorted[0],end_date:sorted[sorted.length-1]});
  const response=await fetch(`${url}?${params}`);
  if(!response.ok) throw Error('Weather unavailable');
  const {daily}=await response.json();
  const byDay={};
  daily.time.forEach((day,i)=>{
    if(daily.weather_code[i]==null) return;
    byDay[day]={kind:weatherKind(daily.weather_code[i]),tmax:Math.round(daily.temperature_2m_max[i]),
      tmin:Math.round(daily.temperature_2m_min[i]),source,year:Number(day.slice(0,4))};
  });
  return byDay;
}
// Weather for each trip day: forecast where there is one, otherwise the same day last year.
async function fetchWeatherDays(place,dates){
  const ahead=date=>(Date.parse(date)-Date.parse(todayDate()))/864e5;
  const near=dates.filter(date=>ahead(date)<=15), far=dates.filter(date=>ahead(date)>15);
  const result={};
  if(near.length) Object.assign(result,await dailyWeather('https://api.open-meteo.com/v1/forecast',place,near,'forecast'));
  if(far.length){
    const past=await dailyWeather('https://archive-api.open-meteo.com/v1/archive',place,far.map(lastYearDay),'lastYear');
    for(const date of far) if(past[lastYearDay(date)]) result[date]=past[lastYearDay(date)];
  }
  return result;
}
async function fetchWeather(place,date){
  const weather=(await fetchWeatherDays(place,[date]))[date];
  if(!weather) throw Error('No weather data');
  return weather;
}
