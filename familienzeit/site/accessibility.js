export const accessOptions = {
  stroller:'Mit Kinderwagen nutzbar',
  stepFree:'Stufenloser Zugang',
  accessibleToilet:'Rollstuhlgerechtes WC',
  hearing:'Hilfen bei Hörbeeinträchtigung',
  vision:'Hilfen bei Sehbeeinträchtigung'
};

export const accessStatuses = {
  unknown:'Ungeklärt',
  yes:'Bestätigt',
  limited:'Eingeschränkt oder nur auf Anfrage',
  no:'Nicht verfügbar'
};

export function meetsAccessNeeds(activity,needs){
  return needs.every(key=>activity.accessibility?.[key]==='yes');
}
