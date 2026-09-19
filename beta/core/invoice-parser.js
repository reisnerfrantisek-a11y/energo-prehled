(function(root,factory){
  let Invoice;
  if(typeof module==='object'&&module.exports)Invoice=require('./invoice.js');
  else Invoice=root.EnergoInvoice;
  const api=factory(Invoice);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.EnergoInvoiceParser=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Invoice){
  'use strict';
  if(!Invoice)throw new Error('EnergoInvoice is required.');

  const PARSER_VERSION='eon-cz-1.5.0';
  const NUM='[0-9]+(?:\\s[0-9]{3})*(?:[.,][0-9]+)?';

  function pdfItemsToRows(items,yTolerance=1.6){
    const rows=[];
    for(const item of Array.isArray(items)?items:[]){
      const str=String(item?.str||'').trim();if(!str)continue;
      const tr=Array.isArray(item?.transform)?item.transform:null,x=Number(tr?.[4]),y=Number(tr?.[5]);
      if(!Number.isFinite(x)||!Number.isFinite(y)){rows.push({y:-rows.length*10,parts:[{x:0,str}]});continue}
      let row=rows.find(r=>Math.abs(r.y-y)<=yTolerance);
      if(!row){row={y,parts:[]};rows.push(row)}
      row.parts.push({x,str});
    }
    return rows.sort((a,b)=>b.y-a.y).map(r=>({y:r.y,parts:r.parts.sort((a,b)=>a.x-b.x)}));
  }
  function rowsToText(rows,predicate=null){
    return (Array.isArray(rows)?rows:[]).map(r=>{
      const parts=predicate?r.parts.filter(predicate):r.parts;
      return parts.map(p=>p.str).join(' ').trim();
    }).filter(Boolean).join('\n');
  }
  function pdfItemsToLayoutText(items,yTolerance=1.6){return rowsToText(pdfItemsToRows(items,yTolerance))}
  function pdfItemsToColumnFlowText(items,splitX=420,yTolerance=1.6){
    const rows=pdfItemsToRows(items,yTolerance);
    const left=rowsToText(rows,p=>p.x<splitX),right=rowsToText(rows,p=>p.x>=splitX);
    return [left,right].filter(Boolean).join('\n');
  }
  function pdfItemsToEolText(items){
    const out=[];let line=[];
    for(const item of Array.isArray(items)?items:[]){
      const str=String(item?.str||'').trim();
      if(str)line.push(str);
      if(item?.hasEOL&&line.length){out.push(line.join(' '));line=[]}
    }
    if(line.length)out.push(line.join(' '));
    return out.join('\n');
  }
  function geometryRows(page,yTolerance=4){
    const width=Number(page?.width)||595,height=Number(page?.height)||842,rows=[];
    for(const item of Array.isArray(page?.items)?page.items:[]){
      const str=String(item?.str||'').trim(),x=Number(item?.x),y=Number(item?.y);
      if(!str||!Number.isFinite(x)||!Number.isFinite(y))continue;
      let row=rows.find(r=>Math.abs(r.y-y)<=yTolerance);
      if(!row){row={y,parts:[]};rows.push(row)}
      row.parts.push({x,str});
    }
    return rows.sort((a,b)=>a.y-b.y).map(r=>({
      y:r.y,width,height,
      parts:r.parts.sort((a,b)=>a.x-b.x),
      text:r.parts.sort((a,b)=>a.x-b.x).map(p=>p.str).join(' ')
    }));
  }
  function geometryNumber(row,minRatio,maxRatio){
    const text=(row?.parts||[]).filter(p=>p.x>=row.width*minRatio&&p.x<row.width*maxRatio).map(p=>p.str).join(' ');
    return parseCzNumber(text);
  }
  function geometryDateMatches(text){
    return [...String(text||'').matchAll(/\d{1,2}\s*\.\s*\d{1,2}\s*\.\s*\d{4}/g)].map(m=>m[0].replace(/\s+/g,''));
  }
  function geometryChargeRow(row){
    const dates=geometryDateMatches(row?.text);
    if(dates.length<2)return null;
    const unit=/\bMWh\b/i.test(row.text)?'MWh':/\bkWh\b/i.test(row.text)?'kWh':/M[ěe]s[ií]c/i.test(row.text)?'Měsíc':null;
    const quantity=geometryNumber(row,.70,.805),unitPrice=geometryNumber(row,.805,.91),total=geometryNumber(row,.91,1.01);
    if(!unit||!Number.isFinite(quantity)||!Number.isFinite(unitPrice)||!Number.isFinite(total))return null;
    return {row,dates,unit,quantity,unitPrice,total};
  }
  function formatCzNumber(v,digits=3){
    if(!Number.isFinite(Number(v)))return '';
    return Number(v).toLocaleString('cs-CZ',{minimumFractionDigits:0,maximumFractionDigits:digits,useGrouping:true});
  }
  function canonicalCharge(label,c){
    if(!c)return '';
    return `${label} ${c.dates[0]} ${c.dates[1]} ${c.unit} ${formatCzNumber(c.quantity,3)} ${formatCzNumber(c.unitPrice,5)} ${formatCzNumber(c.total,2)}`;
  }
  function pdfGeometryToEonText(pages){
    const all=(Array.isArray(pages)?pages:[]).map((page,index)=>({page,index,rows:geometryRows(page,5)}));
    if(!all.length)return '';
    let ean='',eanPage=null,eanRow=null;
    for(const p of all){
      for(const row of p.rows){
        const m=row.text.match(/\b(\d{18})\b/);
        if(m){ean=m[1];eanPage=p;eanRow=row;break}
      }
      if(ean)break;
    }
    const periodCandidates=[];
    for(const p of all)for(const row of p.rows){
      const dates=geometryDateMatches(row.text);
      if(dates.length>=2&&!/\b(?:MWh|kWh|M[ěe]s[ií]c)\b/i.test(row.text)){
        periodCandidates.push({p,row,dates,score:(p===eanPage?30:0)+(row.y<row.height*.30?20:0)-p.index*2-row.y/1000});
      }
    }
    periodCandidates.sort((a,b)=>b.score-a.score);
    const period=periodCandidates[0]||null;

    let documentNumber='';
    const docPages=eanPage?[eanPage,...all.filter(p=>p!==eanPage)]:all;
    for(const p of docPages){
      const rows=p.rows.filter(r=>r.y<r.height*.45);
      for(const row of rows){
        const candidates=[...row.text.matchAll(/\b(\d{8,14})\b/g)].map(m=>m[1]).filter(v=>v!==ean);
        if(candidates.length){documentNumber=candidates[0];break}
      }
      if(documentNumber)break;
    }

    const tablePage=eanPage||all.find(p=>p.rows.some(r=>geometryChargeRow(r)));
    const charges=tablePage?tablePage.rows.map(geometryChargeRow).filter(Boolean).filter(c=>c.row.y>c.row.height*.28&&c.row.y<c.row.height*.67):[];
    charges.sort((a,b)=>a.row.y-b.row.y);
    const mwh=charges.filter(c=>c.unit==='MWh'||c.unit==='kWh'),monthly=charges.filter(c=>c.unit==='Měsíc');
    const highVariable=mwh.filter(c=>c.unitPrice>=500);
    const supply=highVariable[0]||mwh[0]||null;
    const distribution=highVariable[1]||null;
    const tax=mwh.find(c=>c!==supply&&c!==distribution&&c.unitPrice<80)||null;
    const system=mwh.find(c=>c!==supply&&c!==distribution&&c!==tax&&c.unitPrice>=80&&c.unitPrice<500)||null;
    const supplierFixed=monthly[0]||null,breaker=monthly[1]||null,distributionFixed=monthly[2]||null,poze=monthly[3]||null;

    const lines=['E.ON Energie, a.s.'];
    if(period)lines.push(`Odečtové období: ${period.dates[0]} - ${period.dates[1]}`);
    if(documentNumber)lines.push(`${documentNumber} Číslo daňového dokladu`);
    if(ean)lines.push(`${ean} EAN`);
    if(supply){
      const kwh=supply.unit==='MWh'?supply.quantity*1000:supply.quantity;
      lines.push(`Celková spotřeba elektřiny ${formatCzNumber(kwh/1000,5)} MWh`);
    }
    for(const line of [
      canonicalCharge('Dodané množství jednotarif',supply),
      canonicalCharge('Stálý plat',supplierFixed),
      canonicalCharge('Daň z elektřiny',tax),
      canonicalCharge('Cena za distrib. množství elektřiny ve vysokém tarifu',distribution),
      canonicalCharge('Cena za příkon podle hodnoty hl. jističe před elekt.',breaker),
      canonicalCharge('Pevná cena za systémové služby',system),
      canonicalCharge('Cena za provoz nesíťové infrastruktury',distributionFixed),
      canonicalCharge('Složka ceny na podporu el. z podpor. zdrojů energie',poze)
    ])if(line)lines.push(line);
    return lines.join('\n');
  }

  function uniqueCompositeText(candidates){
    const seen=new Set(),lines=[];
    for(const c of Array.isArray(candidates)?candidates:[]){
      for(const rawLine of String(c?.text||'').split(/\n+/)){
        const line=normalizeText(rawLine);if(!line)continue;
        const key=line.toLocaleLowerCase('cs-CZ');
        if(seen.has(key))continue;
        seen.add(key);lines.push(line);
      }
    }
    return lines.join('\n');
  }
  function normalizeText(text){
    return String(text||'').replace(/\u00ad/g,'').replace(/[\u00a0\u202f]/g,' ').replace(/[\t\r\n]+/g,' ').replace(/\s+/g,' ').trim();
  }
  function normalizeLines(text){
    return String(text||'').replace(/\u00ad/g,'').replace(/[\u00a0\u202f]/g,' ').replace(/\r/g,'\n').split(/\n+/).map(line=>line.replace(/[\t ]+/g,' ').trim()).filter(Boolean).join('\n');
  }
  function parseCzNumber(raw){
    if(raw===null||raw===undefined)return null;
    const s=String(raw).replace(/[\u00a0\u202f\s]/g,'').replace(',','.').trim();
    if(!s)return null;
    const n=Number(s);return Number.isFinite(n)?n:null;
  }
  function money(v){const n=parseCzNumber(v);return Number.isFinite(n)?Math.round(n*100)/100:null}
  function isoDate(raw){
    const m=String(raw||'').match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
    return m?`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:'';
  }
  function monthKeyFromPeriod(from,to){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to))return '';
    return from.slice(0,7)===to.slice(0,7)?from.slice(0,7):'';
  }
  function beforeLabel(text,labelSource,tokenSource='[0-9]{6,20}'){
    const direct=new RegExp(`(${tokenSource})\\s+${labelSource}`,'i'),m=text.match(direct);if(m)return String(m[1]).trim();
    const loose=new RegExp(`(${tokenSource})[\\s\\S]{0,140}?${labelSource}`,'i'),n=text.match(loose);return n?String(n[1]).trim():'';
  }
  function first(text,re,group=1){const m=text.match(re);return m?String(m[group]??'').trim():''}
  function collectCharge(text,labelSource){
    const unit='(MWh|kWh|Měsíc|Mesíc|Mesic)';
    const re=new RegExp(`${labelSource}[^\\n]{0,520}?${unit}\\s+(${NUM})\\s+(${NUM})\\s+(${NUM})(?=\\s|$)`,'gi'),out=[],seen=new Set();
    for(const m of text.matchAll(re)){
      const item={
        unit:/^mwh$/i.test(m[1])?'MWh':/^kwh$/i.test(m[1])?'kWh':'Měsíc',
        quantity:parseCzNumber(m[2]),
        unitPrice:parseCzNumber(m[3]),
        total:money(m[4])
      };
      if(!Number.isFinite(item.quantity)||!Number.isFinite(item.unitPrice)||!Number.isFinite(item.total))continue;
      const key=`${item.unit}|${item.quantity}|${item.unitPrice}|${item.total}`;if(seen.has(key))continue;seen.add(key);out.push(item);
    }
    return out;
  }
  function sum(items,key='total'){return items.reduce((a,x)=>a+(Number(x[key])||0),0)}
  function kwhFrom(items){
    return items.reduce((a,x)=>a+(x.unit==='MWh'?x.quantity*1000:x.unit==='kWh'?x.quantity:0),0);
  }
  function monthlyUnits(items){return items.reduce((a,x)=>a+(x.unit==='Měsíc'?x.quantity:0),0)}
  function exactCharge(items){
    return items.reduce((a,x)=>{
      if(x.unit==='MWh'||x.unit==='Měsíc')return a+x.quantity*x.unitPrice;
      if(x.unit==='kWh')return a+(x.quantity*x.unitPrice);
      return a;
    },0);
  }
  function variableRatePerKwh(items){
    const kwh=kwhFrom(items);if(!(kwh>0))return 0;
    return exactCharge(items)/kwh;
  }
  function aggregate(items){
    if(!Array.isArray(items)||!items.length)return {total:null,kwh:0,months:0,perKwh:null,perMonth:null};
    const total=sum(items),kwh=kwhFrom(items),months=monthlyUnits(items);
    return {total:Math.round(total*100)/100,kwh,months,perKwh:kwh>0?total/kwh:null,perMonth:months>0?total/months:null};
  }
  function round(v,d=6){if(!Number.isFinite(v))return null;const p=10**d;return Math.round(v*p)/p}

  function parseEonInvoiceText(rawText,opts={}){
    const layoutText=normalizeLines(rawText),text=normalizeText(rawText),warnings=[],fatal=[],hasLineStructure=layoutText.includes('\n');
    if(!/E\.\s*ON\s+Energie\s*,?\s*a\.s\./i.test(text)&&!/EON\s+Energie/i.test(text))fatal.push('Dokument nebyl rozpoznán jako faktura E.ON Energie.');

    const periodMatch=text.match(/Odečtové období:[\s\S]{0,160}?(\d{1,2}\s*\.\s*\d{1,2}\s*\.\s*\d{4})[\s\S]{0,80}?[-–][\s\S]{0,80}?(\d{1,2}\s*\.\s*\d{1,2}\s*\.\s*\d{4})/i)
      ||text.match(/Vyúčtování bylo provedeno za období od[\s\S]{0,180}?(\d{1,2}\s*\.\s*\d{1,2}\s*\.\s*\d{4})[\s\S]{0,120}?do[\s\S]{0,120}?(\d{1,2}\s*\.\s*\d{1,2}\s*\.\s*\d{4})/i);
    const periodFrom=periodMatch?isoDate(periodMatch[1]):'',periodTo=periodMatch?isoDate(periodMatch[2]):'',invoiceMonthKey=monthKeyFromPeriod(periodFrom,periodTo);
    if(!periodFrom||!periodTo)fatal.push('Nepodařilo se rozpoznat fakturační období.');
    else if(!invoiceMonthKey)fatal.push('Fakturační období přesahuje jeden kalendářní měsíc; měsíční finanční model ji neumí bezpečně přiřadit.');

    const totalsMatch=text.match(new RegExp(`Faktura celkem\\s+(${NUM})\\s+(${NUM})`,'i'));
    const totalExVat=totalsMatch?money(totalsMatch[1]):money(first(text,new RegExp(`Cena celkem\\s+(${NUM})`,'i')));
    const invoiceTotal=totalsMatch?money(totalsMatch[2]):money(first(text,new RegExp(`Nedoplatek\\s+(${NUM})`,'i')));
    if(!Number.isFinite(invoiceTotal))fatal.push('Nepodařilo se rozpoznat celkovou částku faktury.');
    if(!Number.isFinite(totalExVat))fatal.push('Nepodařilo se rozpoznat částku bez DPH.');

    const consumptionMwh=parseCzNumber(first(text,new RegExp(`Celková spotřeba elektřiny[\\s\\S]{0,180}?(${NUM})\\s*MWh`,'i')));
    let consumptionKwh=Number.isFinite(consumptionMwh)?consumptionMwh*1000:null;
    const summaryFixedExVat=parseCzNumber(first(text,new RegExp(`Stálý plat:[\\s\\S]{0,180}?(${NUM})\\s*Kč\\s*\\/\\s*měsíc`,'i')));
    const summaryVariableExVat=parseCzNumber(first(text,new RegExp(`VT:[\\s\\S]{0,180}?(${NUM})\\s*Kč\\s*\\/\\s*kWh`,'i')));
    const ean=first(text,/\b(\d{18})\s*EAN\b/i)||first(text,/\bEAN\s*(\d{18})\b/i);
    const documentNumber=beforeLabel(text,'Číslo daňového dokladu')||first(text,/Příloha k faktuře za elektřinu[\s\S]{0,80}?(\d{8,14})/i);
    const variableSymbol=beforeLabel(text,'Variabilní symbol');
    const issuedAt=isoDate(beforeLabel(text,'Datum vystavení faktury','\\d{1,2}\\.\\s*\\d{1,2}\\.\\s*\\d{4}'));
    const dueAt=isoDate(beforeLabel(text,'Datum splatnosti faktury','\\d{1,2}\\.\\s*\\d{1,2}\\.\\s*\\d{4}'));

    const supply=hasLineStructure?collectCharge(layoutText,'Dodané množství(?:\\s+jednotarif|\\s+ve vysokém tarifu|\\s+ve nízkém tarifu)?'):[];
    const supplierFixed=hasLineStructure?collectCharge(layoutText,'Stálý plat'):[];
    const electricityTax=hasLineStructure?collectCharge(layoutText,'Daň z elektřiny'):[];
    const distributionEnergy=hasLineStructure?collectCharge(layoutText,'Cena za distrib\\.?\\s*množství elektřiny(?:\\s+ve vysokém tarifu|\\s+ve nízkém tarifu)?'):[];
    const breaker=hasLineStructure?collectCharge(layoutText,'Cena za příkon podle hodnoty hl\\.?\\s*jističe[^M]{0,45}'):[];
    const systemServices=hasLineStructure?collectCharge(layoutText,'Pevná cena za systémové služby'):[];
    const distributionFixed=hasLineStructure?collectCharge(layoutText,'Cena za provoz nesíťové infrastruktury'):[];
    let poze=hasLineStructure?collectCharge(layoutText,'Složka ceny na podporu el\\.?\\s*z podpor\\.?\\s*zdrojů energie'):[];
    if(!poze.length&&hasLineStructure)poze=collectCharge(layoutText,'Složka ceny na podporu elektřiny z podporovaných zdrojů energie');

    const groups={supply,supplierFixed,electricityTax,distributionEnergy,breaker,systemServices,distributionFixed,poze};
    const ag={};for(const [k,v] of Object.entries(groups))ag[k]=aggregate(v);
    if(!Number.isFinite(consumptionKwh)||consumptionKwh<=0){
      const lineKwh=ag.supply.kwh||ag.distributionEnergy.kwh;
      if(lineKwh>0)consumptionKwh=lineKwh;
    }

    const knownNet=['supply','supplierFixed','electricityTax','distributionEnergy','breaker','systemServices','distributionFixed','poze'].reduce((a,k)=>a+(Number(ag[k].total)||0),0);
    const recognizedNetCount=['supply','supplierFixed','electricityTax','distributionEnergy','breaker','systemServices','distributionFixed','poze'].filter(k=>Number.isFinite(ag[k].total)).length;

    const vatAmount=Number.isFinite(invoiceTotal)&&Number.isFinite(totalExVat)?Math.round((invoiceTotal-totalExVat)*100)/100:null;
    const vatRateRaw=Number.isFinite(vatAmount)&&totalExVat>0?vatAmount/totalExVat:null;
    const knownVatRates=[0,0.12,0.21],nearestVat=Number.isFinite(vatRateRaw)?knownVatRates.reduce((a,b)=>Math.abs(b-vatRateRaw)<Math.abs(a-vatRateRaw)?b:a,knownVatRates[0]):null;
    const vatRate=Number.isFinite(vatRateRaw)&&Number.isFinite(nearestVat)&&Math.abs(vatRateRaw-nearestVat)<=0.005?nearestVat:vatRateRaw;
    if(Number.isFinite(vatRate)&&(vatRate<0||vatRate>.5))warnings.push('Neobvyklá sazba DPH.');

    const variableNet=[ag.supply.total,ag.electricityTax.total,ag.distributionEnergy.total,ag.systemServices.total,
      poze.some(x=>x.unit==='MWh'||x.unit==='kWh')?ag.poze.total:null].reduce((a,v)=>a+(Number(v)||0),0);
    const fixedItems=[...supplierFixed,...breaker,...distributionFixed,...poze.filter(x=>x.unit==='Měsíc')];
    const fixedNet=fixedItems.length?exactCharge(fixedItems):null;
    const variableItems=[...supply,...electricityTax,...distributionEnergy,...systemServices,...poze.filter(x=>x.unit==='MWh'||x.unit==='kWh')];
    const detailedVariableRate=Number.isFinite(consumptionKwh)&&consumptionKwh>0&&variableItems.length?exactCharge(variableItems)/consumptionKwh:null;
    const fixedMonths=fixedItems.length?Math.max(1,monthlyUnits(fixedItems)/Math.max(1,fixedItems.filter(x=>x.unit==='Měsíc').length)):null;
    const detailedFixedRate=Number.isFinite(fixedMonths)&&fixedMonths>0?exactCharge(fixedItems)/fixedMonths:null;

    let fullCalendarMonth=false;
    if(invoiceMonthKey&&periodFrom&&periodTo){
      const [yy,mm]=invoiceMonthKey.split('-').map(Number),lastDay=new Date(Date.UTC(yy,mm,0)).getUTCDate();
      fullCalendarMonth=periodFrom===`${invoiceMonthKey}-01`&&periodTo===`${invoiceMonthKey}-${String(lastDay).padStart(2,'0')}`;
    }
    const coreVariableRecognized=[ag.supply.total,ag.electricityTax.total,ag.distributionEnergy.total,ag.systemServices.total].every(Number.isFinite);
    const residualFixedExVat=fullCalendarMonth&&coreVariableRecognized&&Number.isFinite(totalExVat)&&Number.isFinite(detailedVariableRate)
      ?Math.round((totalExVat-variableNet)*100)/100:null;
    const residualFixedValidated=Number.isFinite(residualFixedExVat)&&residualFixedExVat>=0;

    const detailedKnownForTariff=Number.isFinite(fixedNet)?Math.round((variableNet+fixedNet)*100)/100:null;
    const detailedTariffDifference=Number.isFinite(totalExVat)&&Number.isFinite(detailedKnownForTariff)?Math.round((totalExVat-detailedKnownForTariff)*100)/100:null;
    const detailTariffValidated=Number.isFinite(consumptionKwh)&&consumptionKwh>0&&Number.isFinite(vatRate)
      &&Number.isFinite(detailedVariableRate)&&Number.isFinite(detailedFixedRate)&&Math.abs(detailedTariffDifference||0)<=0.05;
    const summaryTariffValidated=Number.isFinite(summaryFixedExVat)&&Number.isFinite(summaryVariableExVat)&&Number.isFinite(vatRate);
    const residualTariffValidated=!detailTariffValidated&&!summaryTariffValidated&&residualFixedValidated&&Number.isFinite(vatRate);

    const tariffValidated=detailTariffValidated||summaryTariffValidated||residualTariffValidated;
    const variableExVatPerKwh=detailTariffValidated?detailedVariableRate:summaryTariffValidated?summaryVariableExVat:detailedVariableRate;
    const fixedExVatPerMonth=detailTariffValidated?detailedFixedRate:summaryTariffValidated?summaryFixedExVat:residualFixedExVat;
    const knownForTariff=tariffValidated&&Number.isFinite(fixedExVatPerMonth)?Math.round((variableNet+fixedExVatPerMonth)*100)/100:null;
    const tariffDifference=Number.isFinite(totalExVat)&&Number.isFinite(knownForTariff)?Math.round((totalExVat-knownForTariff)*100)/100:null;

    const unmatched=Number.isFinite(totalExVat)&&recognizedNetCount?Math.round((totalExVat-knownNet)*100)/100:null;
    if(Number.isFinite(unmatched)&&Math.abs(unmatched)>0.05&&!residualTariffValidated)warnings.push(`Součet rozpoznaných položek se liší od ceny bez DPH o ${unmatched.toFixed(2)} Kč.`);

    if(detailTariffValidated&&summaryTariffValidated){
      if(Math.abs(detailedFixedRate-summaryFixedExVat)>.02||Math.abs(detailedVariableRate-summaryVariableExVat)>.02)warnings.push('Detailní sazby se neshodují se souhrnnými cenami na faktuře.');
    }else if(summaryTariffValidated&&!detailTariffValidated)warnings.push('Tarif byl převzat ze souhrnných cen faktury; detailní rozpad nebyl kompletně ověřen.');
    else if(residualTariffValidated)warnings.push(`Fixní složky ${residualFixedExVat.toFixed(2)} Kč byly převzaty souhrnně jako rozdíl ceny bez DPH a rozpoznaných variabilních položek.`);
    else if(!tariffValidated)warnings.push('Tarifní model nebyl plně ověřen; pro predikci zůstane k dispozici statistický model.');

    const grossFactor=Number.isFinite(vatRate)?1+vatRate:null;
    const confidence=fatal.length?0:Math.max(.5,Math.min(1,1-(warnings.length*.12)));

    const finance=Invoice.normalizeFinance({
      invoiceTotal,
      currency:'CZK',
      source:'pdf',
      totals:{exVat:totalExVat,vat:vatAmount,incVat:invoiceTotal},
      components:{
        energy:ag.supply.total,
        distribution:[ag.distributionEnergy.total,ag.systemServices.total,ag.distributionFixed.total,ag.breaker.total,ag.poze.total].some(Number.isFinite)?[ag.distributionEnergy.total,ag.systemServices.total,ag.distributionFixed.total,ag.breaker.total,ag.poze.total].reduce((a,v)=>a+(Number(v)||0),0):null,
        fixed:Number.isFinite(fixedExVatPerMonth)?fixedExVatPerMonth:null,
        other:Number.isFinite(unmatched)&&Math.abs(unmatched)>0.005&&!residualTariffValidated?Math.max(0,unmatched):null,
        supplyEnergy:ag.supply.total,
        distributionEnergy:ag.distributionEnergy.total,
        systemServices:ag.systemServices.total,
        poze:ag.poze.total,
        electricityTax:ag.electricityTax.total,
        supplierFixed:ag.supplierFixed.total,
        breaker:ag.breaker.total,
        distributionFixed:ag.distributionFixed.total,
        vat:vatAmount
      },
      metering:{
        ean,
        consumptionKwh:round(consumptionKwh,3),
        tariffCode:first(text,/\b(D\d{2}d)\b/i),
        breaker:first(text,/\b(\d+x\d+)\b\s+Měsíc/i),
        product:first(text,/Produkt dodávky:\s*([^:]{1,50}?)\s+Produktová řada:/i),
        productSeries:first(text,/Produktová řada:\s*([^:]{1,100}?)\s+Dodané množství/i)
      },
      tariff:{
        fixedExVatPerMonth:round(fixedExVatPerMonth,6),
        variableExVatPerKwh:round(variableExVatPerKwh,6),
        fixedGrossPerMonth:round(Number.isFinite(grossFactor)?fixedExVatPerMonth*grossFactor:null,6),
        variableGrossPerKwh:round(Number.isFinite(grossFactor)&&Number.isFinite(variableExVatPerKwh)?variableExVatPerKwh*grossFactor:null,6),
        vatRate:round(vatRate,6),
        validated:tariffValidated,
        sourceMonthKey:invoiceMonthKey,
        sourceDocumentNumber:documentNumber,
        sourceSupplier:'E.ON Energie, a.s.'
      },
      invoiceMeta:{
        supplier:'E.ON Energie, a.s.',
        documentNumber,variableSymbol,periodFrom,periodTo,issuedAt,dueAt,
        fileName:String(opts.fileName||''),importedAt:String(opts.importedAt||new Date().toISOString()),
        parserVersion:PARSER_VERSION,
        extractionStatus:fatal.length?'failed':warnings.length?'review':'verified',
        extractionConfidence:confidence
      }
    });

    const componentSum=Invoice.componentTotal(finance),componentDifference=Number.isFinite(componentSum)&&Number.isFinite(invoiceTotal)?Math.round((invoiceTotal-componentSum)*100)/100:null;
    if(Number.isFinite(componentDifference)&&Math.abs(componentDifference)>0.05)warnings.push(`Rozpad ceny včetně DPH se liší od celkové faktury o ${componentDifference.toFixed(2)} Kč.`);

    return {
      parser:PARSER_VERSION,
      supplier:'E.ON Energie, a.s.',
      invoiceMonthKey,finance,warnings,fatal,
      canSave:fatal.length===0,
      validation:{
        totalExVat,invoiceTotal,vatAmount,componentSum,componentDifference,
        knownNet:Math.round(knownNet*100)/100,netDifference:unmatched,
        tariffDifference,tariffValidated,detailTariffValidated,summaryTariffValidated,residualTariffValidated,
        residualFixedExVat:round(residualFixedExVat,6),fullCalendarMonth,coreVariableRecognized,
        summaryFixedExVat:round(summaryFixedExVat,6),summaryVariableExVat:round(summaryVariableExVat,6),
        consumptionKwh:round(consumptionKwh,3),ean
      }
    };
  }

  function parseScore(result){
    const f=result?.finance||{},c=f.components||{},m=f.metering||{},meta=f.invoiceMeta||{},t=f.tariff||{},v=result?.validation||{};
    let score=0;
    if(result?.invoiceMonthKey)score+=18;
    if(meta.documentNumber)score+=8;
    if(m.ean)score+=8;
    if(Number.isFinite(m.consumptionKwh)&&m.consumptionKwh>0)score+=14;
    if(Number.isFinite(f.invoiceTotal))score+=8;
    if(Number.isFinite(f.totals?.exVat))score+=6;
    for(const k of ['supplyEnergy','supplierFixed','electricityTax','distributionEnergy','breaker','systemServices','distributionFixed','poze'])if(Number.isFinite(c[k]))score+=4;
    if(t.validated)score+=24;
    if(Number.isFinite(v.componentDifference)&&Math.abs(v.componentDifference)<=0.05)score+=10;
    score-=((result?.fatal?.length)||0)*40;
    score-=((result?.warnings?.length)||0)*3;
    return score;
  }
  function parseEonInvoiceCandidates(candidates,opts={}){
    const list=(Array.isArray(candidates)?candidates:[]).map((c,i)=>typeof c==='string'?{name:`candidate-${i+1}`,text:c}:c).filter(c=>c&&String(c.text||'').trim());
    if(!list.length)return parseEonInvoiceText('',opts);
    const composite=uniqueCompositeText(list);
    if(composite)list.unshift({name:'composite',text:composite});
    const attempts=list.map(c=>{const result=parseEonInvoiceText(c.text,{...opts,extractionStrategy:c.name||''});return {name:c.name||'',result,score:parseScore(result)}});
    attempts.sort((a,b)=>b.score-a.score);
    const best=attempts[0].result;
    best.extractionStrategy=attempts[0].name;
    best.candidateScores=attempts.map(a=>({name:a.name,score:a.score,fatal:a.result.fatal.length,warnings:a.result.warnings.length,tariffValidated:a.result.finance?.tariff?.validated===true}));
    return best;
  }

  return {PARSER_VERSION,pdfItemsToRows,rowsToText,pdfItemsToLayoutText,pdfItemsToColumnFlowText,pdfItemsToEolText,geometryRows,pdfGeometryToEonText,uniqueCompositeText,normalizeText,normalizeLines,parseCzNumber,parseEonInvoiceText,parseEonInvoiceCandidates};
});
