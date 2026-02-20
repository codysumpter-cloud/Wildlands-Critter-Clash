export const NetMsg = {
  INPUT: 'i',
  SNAP: 's',
  EVENT: 'e',
  HELLO: 'h'
};

export function enc(obj){
  return JSON.stringify(obj);
}
export function dec(str){
  return JSON.parse(str);
}
