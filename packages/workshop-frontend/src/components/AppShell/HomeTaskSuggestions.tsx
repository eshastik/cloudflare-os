const examples = [
  {label:'Подготовить документ',prompt:'Помоги подготовить рабочий документ. Уточни, какой результат мне нужен, и используй доступные материалы.'},
  {label:'Разобрать материалы',prompt:'Помоги разобрать файлы и определить, к каким проектам и предметным областям они относятся.'},
  {label:'Найти ответ',prompt:'Найди ответ по рабочим материалам. Уточни мой вопрос и укажи документы, на которых основан ответ.'},
];

export default function HomeTaskSuggestions({onPick}:{onPick:(prompt:string)=>void}) {
  return <div aria-label="Примеры задач" className="flex flex-wrap justify-center gap-x-5 gap-y-2">
    {examples.map(example=><button key={example.label} type="button" onClick={()=>onPick(example.prompt)} className="text-[13px] text-kumo-subtle transition-colors hover:text-kumo-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-kumo-ring">{example.label}</button>)}
  </div>;
}
