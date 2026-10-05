export type TemplateTextChange={kind:'added'|'removed';text:string};
/** Ограничение удерживает сравнение в браузере без квадратичного роста на больших текстах. */
export function templateTextChanges(before:string,after:string):TemplateTextChange[]|null{
 const a=before.replace(/\r\n?/g,'\n').split('\n'),b=after.replace(/\r\n?/g,'\n').split('\n');
 if(a.length>400||b.length>400)return null;
 const width=b.length+1,table=new Uint16Array((a.length+1)*width);
 for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)table[i*width+j]=a[i]===b[j]?1+table[(i+1)*width+j+1]:Math.max(table[(i+1)*width+j],table[i*width+j+1]);
 const changes:TemplateTextChange[]=[];let i=0,j=0;
 while(i<a.length||j<b.length){
  if(i<a.length&&j<b.length&&a[i]===b[j]){i++;j++;}
  else if(i<a.length&&(j===b.length||table[(i+1)*width+j]>=table[i*width+j+1]))changes.push({kind:'removed',text:a[i++]});
  else changes.push({kind:'added',text:b[j++]});
 }
 return changes;
}
