
import React, { useState, useMemo, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { DashboardHeader } from './components/DashboardHeader';
import { ChartRenderer } from './components/ChartRenderer';
import { analyzeData, auditActionPlan } from './services/geminiService';
import { AnalysisState, REQUIRED_COLUMNS, ColumnMapping } from './types';

const App: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [excelHeaders, setExcelHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [rawRows, setRawRows] = useState<any[]>([]);
  const [mainTab, setMainTab] = useState<'ledger' | 'reporting' | 'ai'>('ledger');
  const [activeTab, setActiveTab] = useState<'table' | 'gantt'>('table');
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<any>(null);

  const [aiAuditResult, setAiAuditResult] = useState<any>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const [filters, setFilters] = useState({
    plant: '',
    issue: '',
    class: '',
    category: ''
  });

  const [analysis, setAnalysis] = useState<AnalysisState>({
    loading: false,
    error: null,
    data: null,
    step: 'upload'
  });

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  
  const CLASS_OPTIONS = ["Mechanical", "Electrical", "Operational", "UPWT", "Safety", "Spares", "Quality"];
  const PROGRESS_OPTIONS = ["Not Started", "In Progress", "Completed", "Terminated", "Continuously Works"];
  const TIME_OPTIONS = useMemo(() => {
    const opts: string[] = [];
    const now = new Date();
    const currentYear = now.getFullYear();
    [currentYear - 1, currentYear, currentYear + 1].forEach(year => {
      months.forEach(m => opts.push(`${m} ${year}`));
    });
    return opts;
  }, []);

  const calculateActionQuality = (plan: string) => {
    if (!plan || plan.trim().length < 5) return { score: 10, label: 'Empty', color: '#94a3b8' };
    if (plan.length < 15) return { score: 25, label: 'Vague', color: '#ef4444' };
    const highValueKeywords = ['replace', 'install', 'repair', 'modify', 'calibrate', 'purchase', 'overhaul', 'reinforce', 'upgrade'];
    const lowValueKeywords = ['monitor', 'observe', 'discuss', 'check', 'meeting', 'review'];
    let score = 40;
    const planLower = plan.toLowerCase();
    highValueKeywords.forEach(k => { if(planLower.includes(k)) score += 15; });
    lowValueKeywords.forEach(k => { if(planLower.includes(k)) score += 5; });
    score += Math.min(plan.length / 10, 20);
    const finalScore = Math.min(score, 100);
    if (finalScore > 80) return { score: finalScore, label: 'Technical', color: '#10b981' };
    if (finalScore > 55) return { score: finalScore, label: 'Moderate', color: '#f59e0b' };
    return { score: finalScore, label: 'Procedural', color: '#f97316' };
  };

  const parseDate = (val: any): Date | null => {
    if (!val) return null;
    let date: Date;
    if (typeof val === 'number') {
      date = new Date((val - 25569) * 86400 * 1000);
    } else {
      date = new Date(val);
    }
    return isNaN(date.getTime()) ? null : date;
  };

  const formatDateLabel = (val: any) => {
    const d = parseDate(val);
    if (!d) return "";
    return `${months[d.getMonth()]} ${d.getFullYear()}`;
  };

  const mapClassValue = (val: any): string => {
    const s = String(val || '').trim().toUpperCase();
    const map: Record<string, string> = {
      'O': 'Operational', 'M': 'Mechanical', 'E': 'Electrical',
      'UPWT': 'UPWT', 'H&S': 'Safety', 'S': 'Spares', 'Q': 'Quality'
    };
    return map[s] || s;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    setAnalysis(prev => ({ ...prev, loading: true, error: null }));
    setFile(selectedFile);
    try {
      const data = await selectedFile.arrayBuffer();
      const workbook = XLSX.read(data);
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(firstSheet);
      if (rows.length === 0) throw new Error("The file appears to be empty.");
      const headers = Object.keys(rows[0] as object);
      setExcelHeaders(headers);
      setRawRows(rows);
      const initialMapping: ColumnMapping = {};
      const synonyms: Record<string, string[]> = {
        "Plant Name": ["plant name", "plant"],
        "Chronic Issue": ["chronic issue", "issue"],
        "Failures Description": ["failures description", "failure description", "description"],
        "Duration Loss": ["duration loss (hour per year)", "duration loss", "hour per year"],
        "Frequency": ["frequency (per year)", "frequency", "per year"],
        "Class": ["class", "type"],
        "Action Plan": ["action plan", "action"],
        "Category": ["category", "cat"],
        "Progress": ["progress", "status"],
        "Completion": ["completion", "percent complete"],
        "Start Time": ["start", "start time"],
        "End Time": ["end", "end time"]
      };
      REQUIRED_COLUMNS.forEach(col => {
        let match = headers.find(h => h.trim().toLowerCase() === col.toLowerCase());
        if (!match && synonyms[col]) {
          match = headers.find(h => synonyms[col].some(s => h.trim().toLowerCase() === s.toLowerCase()));
        }
        if (!match && synonyms[col]) {
          match = headers.find(h => synonyms[col].some(s => h.trim().toLowerCase().includes(s.toLowerCase())));
        }
        if (match) initialMapping[col] = match;
      });
      setMapping(initialMapping);
      setAnalysis(prev => ({ ...prev, loading: false, step: 'map' }));
    } catch (err: any) {
      setAnalysis({ loading: false, error: err.message || "Error reading Excel file", data: null, step: 'upload' });
    }
  };

  const startAnalysis = async () => {
    setAnalysis(prev => ({ ...prev, loading: true, step: 'analyze' }));
    try {
      const mappedRows = rawRows.map((row, idx) => {
        const stdRow: any = { _id: `row-${idx}-${Math.random().toString(36).substr(2, 9)}` };
        REQUIRED_COLUMNS.forEach((key) => {
          const excelKey = mapping[key];
          if (excelKey) {
            let val = row[excelKey];
            if (['Start Time', 'End Time'].includes(key)) {
              stdRow[`${key}_Raw`] = parseDate(val);
              val = formatDateLabel(val);
            }
            if (key === 'Class') val = mapClassValue(val);
            if (key === 'Completion' && typeof val === 'number' && val <= 1) {
              val = Math.round(val * 100);
            }
            if (key === 'Duration Loss' || key === 'Frequency') {
              val = Number(val) || 0;
            }
            stdRow[key] = val;
          } else {
             if (['Start Time', 'End Time'].includes(key)) stdRow[`${key}_Raw`] = null;
             stdRow[key] = key === 'Duration Loss' || key === 'Frequency' || key === 'Completion' ? 0 : "";
          }
        });
        stdRow.quality = calculateActionQuality(stdRow['Action Plan']);
        stdRow.ctoQuestion = "";
        stdRow.ctoGrab = "";
        stdRow.ctoPriority = "";
        return stdRow;
      });
      const snippet = JSON.stringify(mappedRows.slice(0, 20), null, 2);
      const aiResponse = await analyzeData(snippet, file?.name || "ACM Export");
      setAnalysis({
        loading: false, error: null, step: 'analyze',
        data: { ...aiResponse, headers: [...REQUIRED_COLUMNS], rows: mappedRows }
      });
    } catch (err: any) {
      setAnalysis(prev => ({ ...prev, loading: false, error: "Analysis failed.", step: 'map' }));
    }
  };

  const handleRunAiAudit = async () => {
    if (!filters.plant) {
      alert("Please select at least a Plant for AI analysis.");
      return;
    }
    setAiLoading(true);
    try {
      const plantActions = analysis.data?.rows.filter(r => String(r['Plant Name']) === filters.plant) || [];
      const res = await auditActionPlan(filters.plant, "Selected Plant Actions", plantActions);
      setAiAuditResult(res);

      if (analysis.data?.rows) {
        const updatedRows = analysis.data.rows.map(row => {
          const matchingAudit = res.audits.find((a: any) => 
            String(a.actionTitle).toLowerCase() === String(row['Chronic Issue']).toLowerCase() &&
            String(a.sourceActionPlan).toLowerCase() === String(row['Action Plan']).toLowerCase()
          );
          if (matchingAudit) {
            return {
              ...row,
              ctoQuestion: matchingAudit.ctoChallengeQuery,
              ctoGrab: matchingAudit.strategicAnchor,
              ctoPriority: matchingAudit.worthTracking
            };
          }
          return row;
        });
        setAnalysis(prev => ({ ...prev, data: prev.data ? { ...prev.data, rows: updatedRows } : null }));
      }
    } catch (e) {
      console.error(e);
      alert("AI Audit failed. Try again.");
    } finally {
      setAiLoading(false);
    }
  };

  const handleEditRow = (row: any) => {
    setEditingId(row._id);
    setEditFormData({ ...row });
  };

  const handleSaveEdit = () => {
    if (!analysis.data || !editFormData) return;
    const updatedRow = { ...editFormData, quality: calculateActionQuality(editFormData['Action Plan']) };
    const newRows = analysis.data.rows.map(r => r._id === editingId ? updatedRow : r);
    setAnalysis(prev => ({ ...prev, data: { ...prev.data!, rows: newRows } }));
    setEditingId(null);
    setEditFormData(null);
  };

  const handleResetRowData = (id: string) => {
    if (!analysis.data) return;
    if (!window.confirm("This will clear action plan and tracking data for this row. Basic failure info remains. Proceed?")) return;
    const newRows = analysis.data.rows.map(r => {
      if (r._id === id) {
        const resetRow = {
          ...r,
          "Action Plan": "",
          "Category": "Uncategorized",
          "Progress": "Not Started",
          "Completion": 0,
          "Start Time": "",
          "End Time": "",
          "Start Time_Raw": null,
          "End Time_Raw": null,
          ctoQuestion: "",
          ctoGrab: "",
          ctoPriority: ""
        };
        return { ...resetRow, quality: calculateActionQuality("") };
      }
      return r;
    });
    setAnalysis(prev => ({ ...prev, data: prev.data ? { ...prev.data, rows: newRows } : null }));
  };

  const handleAddRow = () => {
    if (!analysis.data) return;
    const newId = `row-new-${Date.now()}`;
    const emptyRow: any = {
      _id: newId, 
      "Plant Name": filters.plant || "New Plant", 
      "Chronic Issue": filters.issue || "New Chronic Issue",
      "Failures Description": "Technical details...",
      "Duration Loss": 0, "Frequency": 0, "Class": "Mechanical", 
      "Action Plan": "", "Category": "Uncategorized", 
      "Progress": "Not Started", "Completion": 0,
      "Start Time": "", "End Time": "", 
      "Start Time_Raw": null, "End Time_Raw": null,
      quality: calculateActionQuality(""),
      ctoQuestion: "", ctoGrab: "", ctoPriority: ""
    };
    setAnalysis(prev => ({ ...prev, data: prev.data ? { ...prev.data, rows: [emptyRow, ...prev.data.rows] } : null }));
    setEditingId(newId);
    setEditFormData(emptyRow);
  };

  const filteredData = useMemo(() => {
    if (!analysis.data?.rows) return [];
    return analysis.data.rows.filter(r => {
      const matchPlant = !filters.plant || String(r['Plant Name']) === filters.plant;
      const matchIssue = !filters.issue || String(r['Chronic Issue']) === filters.issue;
      const matchClass = !filters.class || String(r['Class']) === filters.class;
      const matchCategory = !filters.category || String(r['Category']) === filters.category;
      return matchPlant && matchIssue && matchClass && matchCategory;
    });
  }, [analysis.data, filters]);

  const filteredAiAudits = useMemo(() => {
    if (!aiAuditResult || !aiAuditResult.audits) return [];
    if (!filters.issue) return aiAuditResult.audits;
    return aiAuditResult.audits.filter((a: any) => 
      String(a.actionTitle).toLowerCase().includes(filters.issue.toLowerCase()) || 
      filters.issue.toLowerCase().includes(String(a.actionTitle).toLowerCase())
    );
  }, [aiAuditResult, filters.issue]);

  const dashboardStats = useMemo(() => {
    if (filteredData.length === 0) return { metrics: [], plantData: [], categoryData: [], classData: [], frequencyData: [], heatmapData: [], composedData: [] };
    const durationSum = filteredData.reduce((acc, curr) => acc + (Number(curr['Duration Loss']) || 0), 0);
    const avgCompletion = Math.round(filteredData.reduce((acc, curr) => acc + (Number(curr['Completion']) || 0), 0) / filteredData.length);
    const freqSum = filteredData.reduce((acc, curr) => acc + (Number(curr['Frequency']) || 0), 0);
    const avgQuality = Math.round(filteredData.reduce((acc, curr) => acc + (curr.quality.score || 0), 0) / filteredData.length);
    
    const catCounts: Record<string, number> = {};
    filteredData.forEach(r => { if(r.Category) catCounts[r.Category] = (catCounts[r.Category] || 0) + 1; });
    const topCat = Object.entries(catCounts).sort((a,b) => b[1] - a[1])[0]?.[0] || 'N/A';
    
    const plantMap: Record<string, { duration: number, completion: number, count: number, freq: number }> = {};
    const catMap: Record<string, number> = {};
    const classMap: Record<string, number> = {};
    const issueMap: Record<string, { duration: number, frequency: number, name: string }> = {};
    
    filteredData.forEach(r => {
      if(r['Plant Name']) {
        if(!plantMap[r['Plant Name']]) plantMap[r['Plant Name']] = { duration: 0, completion: 0, count: 0, freq: 0 };
        plantMap[r['Plant Name']].duration += (Number(r['Duration Loss']) || 0);
        plantMap[r['Plant Name']].freq += (Number(r['Frequency']) || 0);
        plantMap[r['Plant Name']].completion += (Number(r['Completion']) || 0);
        plantMap[r['Plant Name']].count += 1;
      }
      if(r.Category) catMap[r.Category] = (catMap[r.Category] || 0) + (Number(r['Duration Loss']) || 0);
      if(r.Class) classMap[r.Class] = (classMap[r.Class] || 0) + (Number(r['Duration Loss']) || 0);
      
      const issueKey = `${r['Plant Name']} - ${r['Chronic Issue']}`;
      if(!issueMap[issueKey]) issueMap[issueKey] = { duration: 0, frequency: 0, name: r['Chronic Issue'] };
      issueMap[issueKey].duration += (Number(r['Duration Loss']) || 0);
      issueMap[issueKey].frequency += (Number(r['Frequency']) || 0);
    });

    const heatmap = Object.entries(plantMap).map(([name, stats]) => ({
      name,
      x: stats.duration,
      y: Math.round(stats.completion / stats.count),
      size: stats.freq
    }));

    const composed = Object.values(issueMap)
      .sort((a,b) => b.duration - a.duration)
      .slice(0, 12);

    return {
      metrics: [
        { label: "Aggregate Duration Loss", value: durationSum.toLocaleString() + " hrs", icon: 'fa-clock' },
        { label: "Plan Quality Index", value: avgQuality + "%", icon: 'fa-microchip' },
        { label: "Total Failure Events", value: freqSum.toLocaleString(), icon: 'fa-bolt' },
        { label: "Primary Category", value: topCat, icon: 'fa-tags' }
      ],
      plantData: Object.entries(plantMap).sort((a,b) => b[1].duration - a[1].duration).slice(0, 10).map(([name, stats]) => ({ name, value: stats.duration })),
      categoryData: Object.entries(catMap).map(([name, value]) => ({ name, value })),
      classData: Object.entries(classMap).map(([name, value]) => ({ name, value })),
      frequencyData: Object.entries(plantMap).sort((a,b) => b[1].freq - a[1].freq).slice(0, 10).map(([name, stats]) => ({ name, value: stats.freq })),
      heatmapData: heatmap,
      composedData: composed
    };
  }, [filteredData]);

  const filterOptions = useMemo(() => {
    if (!analysis.data?.rows) return { plants: [], issues: [], classes: [], categories: [] };
    const all = analysis.data.rows;
    const getFieldOptions = (fieldKey: any, fieldId: string) => {
      const data = all.filter(r => {
        return Object.keys(filters).every(key => {
          if (key === fieldId || !filters[key as keyof typeof filters]) return true;
          const map: any = { plant: 'Plant Name', issue: 'Chronic Issue', class: 'Class', category: 'Category' };
          return String(r[map[key]]) === filters[key as keyof typeof filters];
        });
      });
      return Array.from(new Set(data.map(r => String(r[fieldKey])))).filter(Boolean).sort();
    };
    return {
      plants: getFieldOptions('Plant Name', 'plant'),
      issues: getFieldOptions('Chronic Issue', 'issue'),
      classes: getFieldOptions('Class', 'class'),
      categories: getFieldOptions('Category', 'category')
    };
  }, [analysis.data, filters]);

  const excelUniqueCategories = useMemo(() => {
    if (!analysis.data?.rows) return [];
    return Array.from(new Set(analysis.data.rows.map(r => String(r['Category'] || 'Uncategorized')))).filter(Boolean).sort();
  }, [analysis.data]);

  const groupedRows = useMemo(() => {
    const rows = [];
    let lastPlant = "";
    let lastIssue = "";
    let lastFailDesc = "";
    let lastClass = "";
    for (let i = 0; i < filteredData.length; i++) {
      const current = filteredData[i];
      const isNewPlant = current['Plant Name'] !== lastPlant;
      const isNewIssue = isNewPlant || current['Chronic Issue'] !== lastIssue;
      const isNewFailDesc = isNewIssue || current['Failures Description'] !== lastFailDesc;
      const isNewClass = isNewIssue || current['Class'] !== lastClass;
      rows.push({
        ...current,
        displayPlant: isNewPlant ? current['Plant Name'] : "",
        displayIssue: isNewIssue ? current['Chronic Issue'] : "",
        displayFailDesc: isNewFailDesc ? current['Failures Description'] : "",
        displayClass: isNewClass ? current['Class'] : "",
        displayDuration: isNewIssue ? current['Duration Loss'] : "",
        displayFrequency: isNewIssue ? current['Frequency'] : "",
        isFirstInGroup: isNewIssue
      });
      lastPlant = current['Plant Name'];
      lastIssue = current['Chronic Issue'];
      lastFailDesc = current['Failures Description'];
      lastClass = current['Class'];
    }
    return rows;
  }, [filteredData]);

  const timelineConfig = useMemo(() => {
    if (filteredData.length === 0) return { quarters: [], start: null };
    let minDate = new Date();
    let maxDate = new Date();
    filteredData.forEach(r => {
      const s = r['Start Time_Raw'];
      const e = r['End Time_Raw'];
      if (s && s < minDate) minDate = new Date(s);
      if (e && e > maxDate) maxDate = new Date(e);
    });
    minDate = new Date(minDate.getFullYear(), Math.floor(minDate.getMonth() / 3) * 3, 1);
    maxDate = new Date(maxDate.getFullYear(), Math.floor(maxDate.getMonth() / 3) * 3 + 3, 0);
    const quarters = [];
    const current = new Date(minDate);
    while (current <= maxDate) {
      const q = Math.floor(current.getMonth() / 3) + 1;
      quarters.push({ label: `Q${q} ${current.getFullYear()}`, time: current.getTime() });
      current.setMonth(current.getMonth() + 3);
    }
    return { quarters, start: quarters[0]?.time || 0 };
  }, [filteredData]);

  const getPosition = (date: Date | null) => {
    if (!date || !timelineConfig.start) return 0;
    const QUARTER_WIDTH = 160;
    const msInQuarter = 1000 * 60 * 60 * 24 * 91.25;
    const offset = date.getTime() - timelineConfig.start;
    return (offset / msInQuarter) * QUARTER_WIDTH;
  };

  const getStatusColor = (progress: string) => {
    const p = (progress || "").toLowerCase();
    if (p.includes('terminated')) return '#ef4444'; 
    if (p.includes('not started')) return '#94a3b8'; 
    if (p.includes('in progress')) return '#eab308'; 
    if (p.includes('completed')) return '#22c55e'; 
    if (p.includes('continuously')) return '#3b82f6'; 
    return '#6366f1'; 
  };

  const handleFilterChange = (type: keyof typeof filters, value: string) => setFilters(prev => ({ ...prev, [type]: value }));
  const resetAllFilters = () => setFilters({ plant: '', issue: '', class: '', category: '' });

  const exportToExcel = () => {
    if (filteredData.length === 0) return;
    const ws = XLSX.utils.json_to_sheet(filteredData.map(r => {
      const { ['Start Time_Raw']: _s, ['End Time_Raw']: _e, displayPlant, displayIssue, displayClass, isFirstInGroup, _id, quality, ...rest } = r;
      return rest;
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "ACM Ledger");
    XLSX.writeFile(wb, `ACM_Ledger_Export_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  const TABLE_COLUMNS = [
    "Plant Name", "Chronic Issue", "Failures Description", "Duration Loss", "Frequency", "Class", 
    "Action Plan Vague-o-Meter", "Action Plan", "CTO Question", "The Artifact (Grab)", "Tracking Priority", 
    "Category", "Progress", "Completion", "Start Time", "End Time", "Actions"
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <DashboardHeader />
      
      {(filters.plant || filters.issue || filters.class || filters.category) && (
        <button onClick={resetAllFilters} className="fixed bottom-8 right-8 z-[100] bg-blue-600 text-white px-6 py-4 rounded-2xl font-black shadow-2xl hover:bg-slate-900 transition-all flex items-center gap-3">
          <i className="fa-solid fa-filter-circle-xmark"></i> RESET FILTERS
        </button>
      )}

      <main className="flex-1 w-full px-6 py-10 lg:px-10">
        {analysis.step === 'upload' && (
          <div className="mt-20 max-w-4xl mx-auto text-center">
            <h2 className="text-4xl font-black text-slate-900 mb-6 tracking-tight italic">Asset Criticality Mapping Ledger</h2>
            <div className="relative group max-w-2xl mx-auto">
              <div className="absolute -inset-2 bg-gradient-to-r from-blue-600 to-indigo-900 rounded-[2rem] blur opacity-15"></div>
              <div className="relative flex flex-col items-center justify-center p-24 border-2 border-dashed border-slate-200 rounded-[2rem] bg-white hover:border-blue-400 transition-all cursor-pointer shadow-2xl">
                <div className="h-20 w-20 bg-blue-50 text-blue-600 rounded-3xl flex items-center justify-center mb-8 shadow-inner"><i className="fa-solid fa-file-excel text-4xl"></i></div>
                <label className="cursor-pointer">
                  <span className="bg-slate-900 text-white px-14 py-5 rounded-2xl font-black shadow-xl hover:bg-blue-600 transition-all inline-block text-lg tracking-wide uppercase">Upload ACM Ledger</span>
                  <input type="file" className="hidden" accept=".xlsx,.xls,.csv" onChange={handleFileUpload} />
                </label>
              </div>
            </div>
          </div>
        )}

        {analysis.step === 'map' && !analysis.loading && (
          <div className="flex flex-col xl:flex-row gap-10">
            <div className="w-full xl:w-96 flex-shrink-0">
              <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-slate-200 sticky top-24">
                <h2 className="text-2xl font-black text-slate-900 mb-8 tracking-tighter uppercase italic">Ledger Mapping</h2>
                <div className="space-y-5 max-h-[60vh] overflow-y-auto pr-3 custom-scrollbar">
                  {(REQUIRED_COLUMNS as any).map((col: string) => (
                    <div key={col}>
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">{col}</label>
                      <select value={mapping[col] || ""} onChange={(e) => setMapping(prev => ({ ...prev, [col]: e.target.value }))} className={`w-full border rounded-xl px-4 py-3 text-xs font-bold outline-none transition-all ${mapping[col] ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-slate-50 border-slate-200'}`}>
                        <option value="">-- Select Source Column --</option>
                        {excelHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
                <button onClick={startAnalysis} className="mt-10 w-full py-5 bg-blue-600 text-white rounded-2xl font-black shadow-xl uppercase tracking-widest text-sm">Analyze & Generate</button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden bg-white rounded-[2rem] border border-slate-200 shadow-sm flex flex-col h-[75vh]">
              <div className="p-8 bg-slate-50/50 border-b border-slate-100">
                <span className="font-black text-slate-800 text-xs tracking-[0.2em] uppercase">Dataset Stream</span>
              </div>
              <div className="flex-1 overflow-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-white z-10">
                    <tr>{excelHeaders.map(h => <th key={h} className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b bg-white">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {rawRows.slice(0, 30).map((row, i) => (
                      <tr key={i} className="hover:bg-slate-50 border-b border-slate-50">
                        {excelHeaders.map(h => <td key={h} className="px-8 py-4 text-xs font-bold text-slate-600 truncate max-w-[200px]">{String(row[h] ?? '')}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {analysis.loading && (
          <div className="flex flex-col items-center justify-center min-h-[60vh]">
            <div className="relative h-32 w-32 mb-10">
              <div className="absolute inset-0 border-[12px] border-slate-100 rounded-full"></div>
              <div className="absolute inset-0 border-[12px] border-t-blue-600 rounded-full animate-spin"></div>
            </div>
            <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase italic">Processing Intelligence...</h2>
          </div>
        )}

        {analysis.step === 'analyze' && analysis.data && (
          <div className="space-y-6">
            <div className="sticky top-[64px] z-[50] bg-white/90 backdrop-blur-xl -mx-6 px-6 lg:-mx-10 lg:px-10 pb-6 border-b border-slate-200 shadow-sm transition-all duration-300">
              <div className="max-w-[1600px] mx-auto space-y-6 py-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {[
                    { id: 'plant', label: 'Plant Selection', options: filterOptions.plants },
                    { id: 'class', label: 'Asset Class', options: filterOptions.classes },
                    { id: 'category', label: 'Issue Category', options: filterOptions.categories },
                    { id: 'issue', label: 'Specific Chronic Issue', options: filterOptions.issues }
                  ].map((filter) => (
                    <div key={filter.id} className="group">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-[0.15em] mb-1.5 block">{filter.label}</label>
                      <div className="relative">
                        <select 
                          value={filters[filter.id as keyof typeof filters]} 
                          onChange={e => handleFilterChange(filter.id as any, e.target.value)} 
                          className={`w-full appearance-none border-2 rounded-xl px-4 py-2.5 text-[10px] font-black outline-none transition-all shadow-sm
                            ${(filters as any)[filter.id] ? 'bg-blue-600 border-blue-600 text-white' : 'bg-slate-50 border-slate-100 text-slate-700 hover:border-blue-200'}`}
                        >
                          <option value="">All {filter.id.charAt(0).toUpperCase() + filter.id.slice(1)}s</option>
                          {filter.options.map((opt: string) => <option key={opt} value={opt} className="text-slate-900 bg-white">{opt}</option>)}
                        </select>
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none opacity-50">
                          <i className="fa-solid fa-chevron-down text-[8px]"></i>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-10 border-t border-slate-100 pt-4">
                  <button onClick={() => setMainTab('ledger')} className={`pb-2 text-[11px] font-black uppercase tracking-[0.2em] relative transition-colors ${mainTab === 'ledger' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>
                    ACM Ledger View {mainTab === 'ledger' && <div className="absolute -bottom-[1px] left-0 w-full h-1 bg-blue-600 rounded-t-full" />}
                  </button>
                  <button onClick={() => setMainTab('reporting')} className={`pb-2 text-[11px] font-black uppercase tracking-[0.2em] relative transition-colors ${mainTab === 'reporting' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>
                    Reporting Dashboard {mainTab === 'reporting' && <div className="absolute -bottom-[1px] left-0 w-full h-1 bg-blue-600 rounded-t-full" />}
                  </button>
                  <button onClick={() => setMainTab('ai')} className={`pb-2 text-[11px] font-black uppercase tracking-[0.2em] relative transition-colors ${mainTab === 'ai' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>
                    AI Insight ✨ {mainTab === 'ai' && <div className="absolute -bottom-[1px] left-0 w-full h-1 bg-blue-600 rounded-t-full" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="pt-4">
              {mainTab === 'ledger' ? (
                <div className="space-y-10">
                  <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-6">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
                      <div className="flex items-center gap-2 p-1 bg-slate-100 rounded-2xl w-fit">
                        <button onClick={() => setActiveTab('table')} className={`px-8 py-3 rounded-xl text-xs font-black uppercase transition-all ${activeTab === 'table' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}>Table View</button>
                        <button onClick={() => setActiveTab('gantt')} className={`px-8 py-3 rounded-xl text-xs font-black uppercase transition-all ${activeTab === 'gantt' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}>Action Plan</button>
                      </div>
                    </div>
                    <div className="flex gap-4">
                      <button onClick={handleAddRow} className="bg-blue-600 text-white px-6 py-3 rounded-xl text-xs font-black uppercase hover:bg-slate-900 transition-all flex items-center gap-2"><i className="fa-solid fa-plus"></i> Add Action Point</button>
                      <button onClick={exportToExcel} className="bg-slate-900 text-white px-6 py-3 rounded-xl text-xs font-black uppercase hover:bg-blue-600 transition-all flex items-center gap-2"><i className="fa-solid fa-file-arrow-down"></i> Export Excel</button>
                    </div>
                  </div>
                  {activeTab === 'table' ? (
                    <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-xl overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-50">
                              {TABLE_COLUMNS.map(h => <th key={h} className="px-10 py-6 text-[11px] font-black text-slate-500 uppercase tracking-[0.15em] border-b">{h}</th>)}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {groupedRows.map((row) => {
                              const isEditing = editingId === row._id;
                              const statusColor = getStatusColor(row['Progress'] || "");
                              return (
                                <tr key={row._id} className={`hover:bg-slate-50/50 group transition-all duration-200 ${isEditing ? 'bg-blue-50/50' : ''}`}>
                                  <td className="px-10 py-6 text-sm font-black text-slate-900">{isEditing ? <input value={editFormData['Plant Name']} onChange={e => setEditFormData({...editFormData, 'Plant Name': e.target.value})} className="border-2 border-blue-200 rounded-lg px-3 py-1 text-sm outline-none focus:border-blue-500 w-full" /> : row.displayPlant}</td>
                                  <td className="px-10 py-6 text-sm font-bold text-blue-700">{isEditing ? <input value={editFormData['Chronic Issue']} onChange={e => setEditFormData({...editFormData, 'Chronic Issue': e.target.value})} className="border-2 border-blue-200 rounded-lg px-3 py-1 text-sm outline-none focus:border-blue-500 w-full" /> : row.displayIssue}</td>
                                  <td className="px-10 py-6 text-sm font-bold text-slate-800 min-w-[300px] leading-relaxed break-words">{isEditing ? <textarea value={editFormData['Failures Description']} onChange={e => setEditFormData({...editFormData, 'Failures Description': e.target.value})} className="border-2 border-blue-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 w-full h-24 font-bold" /> : row.displayFailDesc}</td>
                                  <td className="px-10 py-6 text-sm font-black text-red-600">{isEditing ? <input type="number" value={editFormData['Duration Loss']} onChange={e => setEditFormData({...editFormData, 'Duration Loss': Number(e.target.value)})} className="border-2 border-blue-200 rounded-lg px-3 py-1 text-sm outline-none focus:border-blue-500 w-24" /> : row.displayDuration}</td>
                                  <td className="px-10 py-6 text-sm font-black text-slate-900">{isEditing ? <input type="number" value={editFormData['Frequency']} onChange={e => setEditFormData({...editFormData, 'Frequency': Number(e.target.value)})} className="border-2 border-blue-200 rounded-lg px-3 py-1 text-sm outline-none focus:border-blue-500 w-24" /> : row.displayFrequency}</td>
                                  <td className="px-10 py-6 text-[10px] font-black text-slate-400 uppercase">{isEditing ? (
                                      <select value={editFormData['Class']} onChange={e => setEditFormData({...editFormData, 'Class': e.target.value})} className="border-2 border-blue-200 rounded-lg px-3 py-1 text-[10px] outline-none focus:border-blue-500 w-full">
                                        {CLASS_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                      </select>
                                    ) : row.displayClass}</td>
                                  <td className="px-10 py-6 min-w-[150px]">
                                     <div className="flex flex-col gap-1.5">
                                        <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                                           <div className="h-full transition-all duration-500" style={{ width: `${row.quality.score}%`, backgroundColor: row.quality.color }}></div>
                                        </div>
                                        <span className="text-[10px] font-black uppercase tracking-tighter" style={{ color: row.quality.color }}>{row.quality.label} ({row.quality.score}%)</span>
                                     </div>
                                  </td>
                                  <td className="px-10 py-6 text-sm font-bold text-slate-800 leading-relaxed min-w-[400px] break-words">{isEditing ? <textarea value={editFormData['Action Plan']} onChange={e => setEditFormData({...editFormData, 'Action Plan': e.target.value})} className="border-2 border-blue-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 w-full h-24" /> : row['Action Plan']}</td>
                                  
                                  <td className="px-10 py-6 text-xs font-black text-blue-700 bg-blue-50/30 min-w-[250px] leading-tight italic">{row.ctoQuestion || "--"}</td>
                                  <td className="px-10 py-6 text-xs font-bold text-slate-900 bg-blue-50/30">{row.ctoGrab || "--"}</td>
                                  <td className="px-10 py-6 text-[10px] font-black text-slate-900 uppercase bg-blue-50/30">{row.ctoPriority || "--"}</td>

                                  <td className="px-10 py-6 text-[10px] font-black text-slate-500 uppercase">{isEditing ? (
                                      <select value={editFormData['Category']} onChange={e => setEditFormData({...editFormData, 'Category': e.target.value})} className="border-2 border-blue-200 rounded-lg px-3 py-1 text-[10px] outline-none focus:border-blue-500 w-full">
                                        {excelUniqueCategories.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                        {!excelUniqueCategories.includes(editFormData['Category']) && <option value={editFormData['Category']}>{editFormData['Category']}</option>}
                                      </select>
                                    ) : row['Category']}</td>
                                  <td className="px-10 py-6">{isEditing ? (
                                      <select value={editFormData['Progress']} onChange={e => setEditFormData({...editFormData, 'Progress': e.target.value})} className="border-2 border-blue-200 rounded-lg px-3 py-1 text-xs outline-none focus:border-blue-500 w-full">
                                        {PROGRESS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                                      </select>
                                    ) : (
                                      <div className="inline-flex items-center gap-2.5 px-4 py-2 rounded-xl bg-white border border-slate-200 shadow-sm min-w-[130px]" style={{ borderLeft: `5px solid ${statusColor}` }}>
                                        <span className="text-[10px] font-black text-slate-700 uppercase tracking-widest">{row['Progress']}</span>
                                      </div>
                                    )}</td>
                                  <td className="px-10 py-6">{isEditing ? (
                                      <input type="number" min="0" max="100" value={editFormData['Completion']} onChange={e => setEditFormData({...editFormData, 'Completion': Number(e.target.value)})} className="border-2 border-blue-200 rounded-lg px-3 py-1 text-sm outline-none focus:border-blue-500 w-20" />
                                    ) : (
                                      <div className="flex items-center gap-3">
                                        <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden border">
                                          <div className="h-full bg-slate-900" style={{ width: `${row['Completion']}%` }}></div>
                                        </div>
                                        <span className="text-xs font-black">{row['Completion']}%</span>
                                      </div>
                                    )}</td>
                                  <td className="px-10 py-6">{isEditing ? (
                                      <select value={editFormData['Start Time']} onChange={e => setEditFormData({...editFormData, 'Start Time': e.target.value})} className="border-2 border-blue-200 rounded-lg px-3 py-1 text-[11px] outline-none focus:border-blue-500 w-28">
                                        <option value="">N/A</option>
                                        {TIME_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                      </select>
                                    ) : <span className="text-[11px] font-bold text-slate-500">{row['Start Time']}</span>}</td>
                                  <td className="px-10 py-6">{isEditing ? (
                                      <select value={editFormData['End Time']} onChange={e => setEditFormData({...editFormData, 'End Time': e.target.value})} className="border-2 border-blue-200 rounded-lg px-3 py-1 text-[11px] outline-none focus:border-blue-500 w-28">
                                        <option value="">N/A</option>
                                        {TIME_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                      </select>
                                    ) : <span className="text-[11px] font-bold text-slate-500">{row['End Time']}</span>}</td>
                                  <td className="px-10 py-6">
                                    <div className="flex items-center gap-3 justify-center">
                                      {isEditing ? (
                                        <button onClick={handleSaveEdit} className="h-10 w-10 bg-green-500 text-white rounded-xl flex items-center justify-center shadow-lg hover:bg-green-600 transition-all"><i className="fa-solid fa-check"></i></button>
                                      ) : (
                                        <button onClick={() => handleEditRow(row)} className="h-10 w-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center hover:bg-blue-100 transition-all"><i className="fa-solid fa-pen-to-square"></i></button>
                                      )}
                                      <button onClick={() => handleResetRowData(row._id)} className="h-10 w-10 bg-orange-50 text-orange-600 rounded-xl flex items-center justify-center hover:bg-orange-100 transition-all" title="Reset/Delete Action Points"><i className="fa-solid fa-eraser"></i></button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-xl overflow-hidden flex flex-col">
                      <div className="h-[700px] overflow-auto custom-scrollbar">
                        <div className="relative min-w-full" style={{ width: `${450 + (timelineConfig.quarters.length * 160)}px` }}>
                          <div className="sticky top-0 z-40 flex bg-white border-b h-16">
                            <div className="sticky left-0 z-50 w-[450px] bg-white border-r-[4px] px-10 flex items-center text-[11px] font-black text-slate-500 uppercase tracking-widest">Asset / Chronic Issue</div>
                            {timelineConfig.quarters.map((q, i) => <div key={i} className="w-[160px] flex-shrink-0 h-full border-r flex items-center justify-center text-[10px] font-black text-slate-500 bg-white">{q.label}</div>)}
                          </div>
                          {filteredData.map((row, idx) => {
                            const startX = getPosition(row['Start Time_Raw']);
                            const endX = getPosition(row['End Time_Raw'] || new Date());
                            return (
                              <div key={row._id} className={`flex h-24 border-b group ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'}`}>
                                <div className={`sticky left-0 z-30 w-[450px] shrink-0 border-r-[4px] px-10 flex flex-col justify-center ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}`}>
                                  <div className="text-[9px] font-black text-blue-500 uppercase mb-1 truncate">{row['Plant Name']} | {row['Chronic Issue']}</div>
                                  <p className="text-xs font-bold text-slate-700 line-clamp-2 leading-tight">{row['Action Plan']}</p>
                                </div>
                                <div className="relative flex-1 flex items-center">
                                  <div className="absolute h-10 rounded-lg shadow-sm flex items-center transition-all hover:scale-[1.02] cursor-default" 
                                    style={{ left: `${startX}px`, width: `${Math.max(endX - startX, 24)}px`, backgroundColor: getStatusColor(row['Progress'] || "") }}>
                                    <div className="absolute right-[-55px] text-[10px] font-black text-slate-600 tabular-nums">{row['Completion']}%</div>
                                    <div className="h-full bg-black/10 rounded-l-lg" style={{ width: `${row['Completion']}%` }}></div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : mainTab === 'reporting' ? (
                <div className="space-y-12 max-w-[1600px] mx-auto pb-20">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
                    {dashboardStats.metrics.map((m, i) => (
                      <div key={i} className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm hover:shadow-xl transition-all group">
                        <div className="flex items-center gap-5">
                          <div className="h-16 w-16 bg-slate-900 text-white rounded-3xl flex items-center justify-center text-2xl group-hover:bg-blue-600 transition-colors">
                            <i className={`fa-solid ${m.icon}`}></i>
                          </div>
                          <div>
                            <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-1">{m.label}</p>
                            <h4 className="text-2xl font-black text-slate-900 tracking-tight">{m.value}</h4>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  {/* Strategic ROI Matrix (Heatmap) */}
                  <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm">
                     <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-6 mb-10">
                        <div>
                           <h3 className="text-sm font-black text-slate-900 uppercase tracking-[0.2em] italic">Strategic ROI Matrix (Asset Heatmap)</h3>
                           <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1 italic">HQ Executive Compliance Monitoring Tool</p>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div className="p-3 rounded-2xl bg-blue-50 border border-blue-100">
                            <div className="flex items-center gap-2 mb-1"><div className="h-2 w-2 bg-blue-500 rounded-full"></div><span className="text-[9px] font-black uppercase text-blue-700">Excellence</span></div>
                            <p className="text-[8px] font-medium text-blue-600 leading-tight">High Progress, Low Impact (Optimized)</p>
                          </div>
                          <div className="p-3 rounded-2xl bg-red-50 border border-red-100">
                            <div className="flex items-center gap-2 mb-1"><div className="h-2 w-2 bg-red-500 rounded-full"></div><span className="text-[9px] font-black uppercase text-red-700">Friction Zone</span></div>
                            <p className="text-[8px] font-medium text-red-600 leading-tight">High Impact, High Complexity</p>
                          </div>
                          <div className="p-3 rounded-2xl bg-orange-50 border border-orange-100">
                            <div className="flex items-center gap-2 mb-1"><div className="h-2 w-2 bg-orange-500 rounded-full"></div><span className="text-[9px] font-black uppercase text-orange-700">Negligence</span></div>
                            <p className="text-[8px] font-medium text-orange-600 leading-tight">High Impact, Low Progress (Escalate)</p>
                          </div>
                          <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100">
                            <div className="flex items-center gap-2 mb-1"><div className="h-2 w-2 bg-slate-400 rounded-full"></div><span className="text-[9px] font-black uppercase text-slate-700">Compliance</span></div>
                            <p className="text-[8px] font-medium text-slate-500 leading-tight">Routine Maintenance Cycle</p>
                          </div>
                        </div>
                     </div>
                     <div className="relative p-10 mt-10">
                       <div className="absolute inset-0 m-10 pointer-events-none grid grid-cols-2 grid-rows-2">
                          <div className="border-r border-b border-slate-100 bg-slate-50/20"></div>
                          <div className="border-b border-slate-100 bg-red-50/10"></div>
                          <div className="border-r border-slate-100 bg-blue-50/10"></div>
                          <div className="bg-orange-50/20"></div>
                       </div>
                       <div className="h-[500px] w-full relative border-l-2 border-b-2 border-slate-900">
                          {dashboardStats.heatmapData.map((point, idx) => {
                            const maxLoss = Math.max(...dashboardStats.heatmapData.map(p => p.x), 1);
                            const leftPos = (point.x / maxLoss) * 100;
                            const bottomPos = point.y;
                            const isHighLoss = point.x > (maxLoss * 0.5);
                            const isLowProgress = point.y < 30;
                            const bubbleColor = isLowProgress && isHighLoss ? '#ef4444' : point.y > 70 ? '#3b82f6' : '#64748b';
                            return (
                              <div key={idx} className="absolute transition-all hover:scale-125 cursor-pointer group z-10" style={{ left: `${leftPos}%`, bottom: `${bottomPos}%`, transform: 'translate(-50%, 50%)' }}>
                                 <div className="w-10 h-10 rounded-full shadow-2xl border-4 border-white flex items-center justify-center overflow-hidden" style={{ backgroundColor: bubbleColor }}>
                                    <span className="text-[9px] font-black text-white">{point.y}%</span>
                                 </div>
                                 <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 text-center">
                                    <p className="text-[9px] font-black text-slate-900 whitespace-nowrap bg-white/80 px-2 rounded-md">{point.name}</p>
                                    <p className="text-[8px] font-bold text-slate-500">{point.x}h loss</p>
                                 </div>
                              </div>
                            );
                          })}
                       </div>
                     </div>
                  </div>

                  {/* Restored Pie Charts for Categories and Asset Classes */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <ChartRenderer 
                      config={{ id: 'pie-category', type: 'pie', title: 'Issue Category Distribution (%)', xAxis: 'name', yAxis: 'value' }} 
                      data={dashboardStats.categoryData} 
                    />
                    <ChartRenderer 
                      config={{ id: 'pie-class', type: 'pie', title: 'Asset Class Distribution (%)', xAxis: 'name', yAxis: 'value' }} 
                      data={dashboardStats.classData} 
                    />
                  </div>

                  <div className="space-y-8">
                    <ChartRenderer config={{ id: 'dur-plant', type: 'bar', title: 'Top 10 Operational Impacts by Asset (Duration Hrs)', xAxis: 'name', yAxis: 'value', rotatedLabels: true }} data={dashboardStats.plantData} />
                    <ChartRenderer config={{ id: 'freq-plant', type: 'bar', title: 'Top 10 Fault Frequency Analysis', xAxis: 'name', yAxis: 'value', rotatedLabels: true }} data={dashboardStats.frequencyData} />
                  </div>
                  <div className="space-y-8">
                    <ChartRenderer config={{ id: 'impact-composed', type: 'composed' as any, title: filters.plant ? `Chronic Issue Impact Profile: ${filters.plant}` : 'Global Issue Impact Profile (Bars: Duration, Line: Frequency)', xAxis: 'name', yAxis: 'duration' }} data={dashboardStats.composedData} />
                  </div>
                </div>
              ) : (
                <div className="space-y-10 animate-in fade-in slide-in-from-bottom-6 duration-700 pb-20">
                  <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 rounded-[3rem] p-12 text-white relative overflow-hidden shadow-2xl">
                    <div className="absolute top-0 right-0 p-12 opacity-5 rotate-12 select-none pointer-events-none"><i className="fa-solid fa-brain text-[200px]"></i></div>
                    <div className="relative z-10 grid grid-cols-1 lg:grid-cols-3 gap-12">
                      <div className="lg:col-span-2">
                        <div className="flex items-center gap-4 mb-4"><span className="bg-blue-600/40 text-blue-400 text-[10px] font-black uppercase tracking-[0.4em] px-5 py-2 rounded-full border border-blue-500/30">Strategic Corporate Audit</span></div>
                        <h2 className="text-5xl font-black tracking-tight mb-6 italic leading-tight">
                          {filters.issue ? `Detailed Audit: ${filters.issue}` : 'Plant-Wide Performance Alignment'}
                        </h2>
                        {aiAuditResult ? (
                          <div className="bg-white/10 backdrop-blur-md p-8 rounded-[2.5rem] border border-white/10">
                             <h3 className="text-xs font-black text-blue-400 uppercase tracking-widest mb-3 flex items-center gap-2"><i className="fa-solid fa-user-tie"></i> Executive Briefing: {filters.plant}</h3>
                             <p className="text-lg font-medium text-slate-100 leading-relaxed italic">"{aiAuditResult.ceoBrief}"</p>
                          </div>
                        ) : (
                          <p className="text-slate-300 text-lg font-medium leading-relaxed max-w-2xl">
                            {filters.issue 
                              ? `Gemini will now analyze every single action plan entry for "${filters.issue}" at the "${filters.plant}" site to ensure zero data loss and maximum technical compliance.`
                              : "Select a specific Chronic Issue from the filter above to perform a 1:1 granular audit of every technical action point."}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col justify-center items-center lg:items-end gap-6">
                        <button onClick={handleRunAiAudit} disabled={aiLoading || !filters.plant} className={`group px-12 py-7 bg-blue-600 rounded-[2rem] font-black uppercase tracking-widest text-sm hover:bg-white hover:text-slate-900 transition-all shadow-2xl flex items-center gap-4 ${aiLoading || !filters.plant ? 'opacity-50 cursor-not-allowed' : ''}`}>
                          {aiLoading ? <i className="fa-solid fa-circle-notch animate-spin"></i> : <i className="fa-solid fa-wand-magic-sparkles group-hover:rotate-12 transition-transform"></i>}
                          {aiLoading ? 'Auditing Dataset...' : filters.issue ? 'Audit Full Issue Detail' : 'Audit Plant Summary'}
                        </button>
                        {aiAuditResult && (
                          <div className="text-center lg:text-right">
                             <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Compliance Score</span>
                             <div className="text-6xl font-black text-white tabular-nums tracking-tighter">{aiAuditResult.overallScore}<span className="text-xl text-blue-400">/100</span></div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  {aiAuditResult && (
                    <div className="grid grid-cols-1 gap-8 animate-in fade-in slide-in-from-bottom-8 duration-1000">
                      <div className="flex items-center justify-between px-2">
                         <h3 className="text-xs font-black uppercase tracking-[0.3em] text-slate-400">
                           {filters.issue ? `Full Issue Audit (All Action Points Analyzed)` : 'Plant Issue Distribution Audit'}
                         </h3>
                      </div>
                      
                      <div className="space-y-10">
                        {filteredAiAudits.map((audit: any, i: number) => {
                          const riskColor = audit.riskLevel === 'High' ? '#ef4444' : audit.riskLevel === 'Medium' ? '#f59e0b' : '#22c55e';
                          return (
                            <div key={i} className="group bg-white p-10 rounded-[4rem] border border-slate-200 shadow-sm hover:shadow-2xl transition-all duration-500 relative overflow-hidden">
                              <div className="absolute top-0 right-0 w-80 h-80 bg-slate-50/50 rounded-full translate-x-32 -translate-y-32"></div>
                              <div className="relative z-10">
                                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-8 mb-10 pb-8 border-b border-slate-100">
                                  <div>
                                     <div className="flex items-center gap-4 mb-3">
                                       <div className="h-10 w-10 bg-slate-900 text-white rounded-2xl flex items-center justify-center shadow-lg group-hover:bg-blue-600 transition-colors"><i className="fa-solid fa-gears text-sm"></i></div>
                                       <h5 className="font-black text-slate-900 text-2xl tracking-tight leading-none italic">{audit.actionTitle}</h5>
                                     </div>
                                     <div className="flex flex-wrap gap-3">
                                        <span className="bg-slate-100 text-slate-600 text-[10px] font-black px-4 py-1.5 rounded-full uppercase tracking-widest">{audit.impactCategory}</span>
                                        <span className="text-[10px] font-black px-4 py-1.5 rounded-full uppercase border-2 flex items-center gap-2" style={{ color: riskColor, borderColor: riskColor, backgroundColor: `${riskColor}08` }}>Risk: {audit.riskLevel}</span>
                                        <span className="text-[10px] font-black px-4 py-1.5 rounded-full uppercase border-2 flex items-center gap-2 bg-slate-50 text-slate-700 border-slate-200">Status: {audit.ytdStatus}</span>
                                        {audit.worthTracking && (
                                          <span className="text-[10px] font-black px-4 py-1.5 rounded-full uppercase bg-slate-900 text-white flex items-center gap-2"><i className="fa-solid fa-map-pin"></i> {audit.worthTracking}</span>
                                        )}
                                     </div>
                                  </div>
                                  <div className="bg-blue-600 text-white px-8 py-5 rounded-[2rem] text-center shrink-0 shadow-xl shadow-blue-100 group-hover:scale-105 transition-transform"><span className="text-[9px] font-black uppercase tracking-[0.2em] block mb-2 opacity-80">Recommendation</span><span className="text-sm font-black uppercase">{audit.recommendation}</span></div>
                                </div>

                                <div className="mb-10">
                                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] block mb-3">Source Action Plan (Excel Entry)</label>
                                  <div className="bg-slate-100 text-slate-600 p-6 rounded-3xl font-mono text-xs leading-relaxed border border-slate-200 shadow-inner">
                                    {audit.sourceActionPlan || "No source text."}
                                  </div>
                                </div>

                                <div className="mb-10 grid grid-cols-1 md:grid-cols-2 gap-8">
                                  <div className="bg-slate-900 text-white p-8 rounded-[3rem] border-l-[12px] border-blue-500 shadow-2xl relative">
                                    <div className="absolute top-4 right-8 opacity-20"><i className="fa-solid fa-user-shield text-4xl"></i></div>
                                    <label className="text-[10px] font-black text-blue-400 uppercase tracking-[0.2em] block mb-4">Question for Installation (Grab them here)</label>
                                    <p className="text-lg font-black leading-tight italic text-blue-50">"{audit.ctoChallengeQuery}"</p>
                                  </div>
                                  <div className="bg-white border-2 border-slate-900 p-8 rounded-[3rem] shadow-xl flex flex-col justify-center">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] block mb-4">The Grab (Technical Artifact)</label>
                                    <div className="flex items-center gap-5">
                                      <div className="h-14 w-14 bg-slate-100 text-slate-900 rounded-2xl flex items-center justify-center text-xl shrink-0"><i className="fa-solid fa-paperclip"></i></div>
                                      <p className="text-sm font-black text-slate-900 uppercase tracking-tight">{audit.strategicAnchor}</p>
                                    </div>
                                  </div>
                                </div>

                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-12 pt-8 border-t border-slate-100">
                                   <div className="lg:col-span-1">
                                      <div className="flex items-center gap-3 mb-4"><div className="h-8 w-8 bg-amber-50 text-amber-600 rounded-lg flex items-center justify-center text-xs"><i className="fa-solid fa-comment-dots"></i></div><label className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Executive Insight</label></div>
                                      <div className="bg-amber-50/50 p-6 rounded-3xl border border-amber-100 relative mb-6"><p className="text-sm text-amber-900 font-bold leading-relaxed italic">"{audit.ceoTalkingPoint}"</p></div>
                                   </div>
                                   <div className="lg:col-span-1 space-y-6">
                                      <div><label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] block mb-3">Verification Strategy</label><p className="text-sm text-slate-700 font-bold leading-relaxed flex items-start gap-3"><i className="fa-solid fa-satellite-dish text-blue-500 mt-1"></i>{audit.trackability}</p></div>
                                      <div><label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] block mb-3">Technical Rating</label><p className="text-sm font-black text-slate-900 uppercase tracking-tighter italic">{audit.qualityRating}</p></div>
                                   </div>
                                   <div className="lg:col-span-1"><label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] block mb-3">Detailed Justification</label><p className="text-sm text-slate-600 font-medium leading-relaxed italic bg-slate-50 p-6 rounded-3xl border border-slate-100">"{audit.justification}"</p></div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
