
import React from 'react';
import {
  BarChart, Bar, PieChart, Pie, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell,
  LabelList, ZAxis, ComposedChart, Line
} from 'recharts';
import { ChartConfig } from '../types';

interface ChartRendererProps {
  config: ChartConfig & { rotatedLabels?: boolean; isPercentage?: boolean };
  data: any[];
}

const COLORS = ['#1e293b', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#6366f1', '#ec4899', '#14b8a6', '#f97316'];

export const ChartRenderer: React.FC<ChartRendererProps> = ({ config, data }) => {
  const renderChart = () => {
    switch (config.type) {
      case 'bar':
        return (
          <BarChart data={data} margin={{ top: 25, right: 30, left: 20, bottom: 60 }}>
            <defs>
              <linearGradient id={`barGradient-${config.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#60a5fa" stopOpacity={1}/>
                <stop offset="100%" stopColor="#1d4ed8" stopOpacity={1}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis 
              dataKey={config.xAxis} 
              axisLine={false} 
              tickLine={false} 
              tick={{ fontSize: 10, fill: '#64748b', fontWeight: 700 }} 
              interval={0}
              angle={config.rotatedLabels ? -45 : 0}
              textAnchor={config.rotatedLabels ? "end" : "middle"}
            />
            <YAxis 
              axisLine={false} 
              tickLine={false} 
              tick={{ fontSize: 10, fill: '#64748b' }} 
            />
            <Tooltip 
              cursor={{ fill: '#f8fafc', radius: 4 }}
              contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)', fontSize: '12px' }} 
            />
            <Bar dataKey={config.yAxis} fill={`url(#barGradient-${config.id})`} radius={[6, 6, 0, 0]} barSize={50}>
              <LabelList 
                dataKey={config.yAxis} 
                position="top" 
                style={{ fontSize: '10px', fontWeight: 'bold', fill: '#1e40af' }} 
              />
            </Bar>
          </BarChart>
        );
      case 'composed' as any:
        return (
          <ComposedChart data={data} margin={{ top: 25, right: 30, left: 20, bottom: 80 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis 
              dataKey="name" 
              axisLine={false} 
              tickLine={false} 
              tick={{ fontSize: 9, fill: '#64748b', fontWeight: 700 }} 
              interval={0}
              angle={-45}
              textAnchor="end"
            />
            <YAxis 
              yAxisId="left"
              axisLine={false} 
              tickLine={false} 
              tick={{ fontSize: 10, fill: '#3b82f6' }} 
              label={{ value: 'Duration (h)', angle: -90, position: 'insideLeft', fontSize: 10, fontWeight: 'bold', fill: '#3b82f6' }}
            />
            <YAxis 
              yAxisId="right"
              orientation="right"
              axisLine={false} 
              tickLine={false} 
              tick={{ fontSize: 10, fill: '#f59e0b' }} 
              label={{ value: 'Frequency', angle: 90, position: 'insideRight', fontSize: 10, fontWeight: 'bold', fill: '#f59e0b' }}
            />
            <Tooltip 
              contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)', fontSize: '12px' }} 
            />
            <Legend verticalAlign="top" align="right" wrapperStyle={{ fontSize: '10px', fontWeight: 'bold', paddingBottom: '20px' }} />
            <Bar yAxisId="left" dataKey="duration" name="Duration Loss (hrs)" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={40} />
            <Line yAxisId="right" type="monotone" dataKey="frequency" name="Frequency" stroke="#f59e0b" strokeWidth={3} strokeDasharray="5 5" dot={{ r: 4, fill: '#f59e0b', strokeWidth: 2, stroke: '#fff' }} />
          </ComposedChart>
        );
      case 'pie':
        const currentTotal = data.reduce((acc, curr) => acc + (Number(curr[config.yAxis]) || 0), 0);
        const pieData = data.map(item => {
          const val = Number(item[config.yAxis]) || 0;
          const percent = currentTotal > 0 ? (val / currentTotal) : 0;
          return {
            ...item,
            formattedPercent: (percent * 100).toFixed(1)
          };
        });

        return (
          <PieChart>
            <Pie
              data={pieData}
              cx="50%"
              cy="50%"
              innerRadius={70}
              outerRadius={100}
              paddingAngle={3}
              dataKey={config.yAxis}
              nameKey={config.xAxis}
              stroke="none"
              label={({ percent }) => `${(percent * 100).toFixed(1)}%`}
              labelLine={true}
            >
              {pieData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip 
              formatter={(value: any, name: any, props: any) => [
                `${value.toLocaleString()} (${props.payload.formattedPercent}%)`, 
                name
              ]}
              contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} 
            />
            <Legend 
              iconType="circle" 
              layout="horizontal" 
              verticalAlign="bottom" 
              align="center"
              wrapperStyle={{ fontSize: '10px', fontWeight: 'bold', paddingTop: '20px' }} 
            />
          </PieChart>
        );
      default:
        return null;
    }
  };

  return (
    <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-200 hover:shadow-xl hover:border-blue-100 transition-all duration-300 h-full">
      <div className="flex items-center justify-between mb-8">
        <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest flex items-center gap-3">
          <span className="h-1.5 w-6 rounded-full bg-blue-600"></span>
          {config.title}
        </h3>
      </div>
      <div className="h-[400px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          {renderChart() as any}
        </ResponsiveContainer>
      </div>
    </div>
  );
};
