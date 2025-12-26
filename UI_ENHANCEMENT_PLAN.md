# Nightfall UI Enhancement Plan

**Status:** Merged into `implementation-spec.md` (2025-12-26) — kept for reference
**Created:** 2025-12-26
**User Priorities:** Crew & Task Focus, Information Density, Visual Drama

---

## Executive Summary

This plan outlines 7 UI enhancements to improve visual feedback, information density, and dramatic presentation in the Nightfall application. The features are organized into 3 phases, starting with quick wins that provide immediate value, followed by core UX improvements, and finishing with visual polish.

**Total Estimated Effort:** 21-29 hours

---

## Table of Contents

1. [Phase A: Quick Wins](#phase-a-quick-wins)
   - [Feature 1: Task Highlighting on Map](#feature-1-task-highlighting-on-map)
   - [Feature 2: Smoother Phase Transitions](#feature-2-smoother-phase-transitions)
   - [Feature 3: Regional Health Ring](#feature-3-regional-health-ring)
2. [Phase B: Core UX](#phase-b-core-ux)
   - [Feature 4: Task Management UX](#feature-4-task-management-ux)
   - [Feature 5: Hover Tooltips](#feature-5-hover-tooltips)
3. [Phase C: Visual Polish](#phase-c-visual-polish)
   - [Feature 6: Animated Rust Spread](#feature-6-animated-rust-spread)
   - [Feature 7: Crew Travel Paths](#feature-7-crew-travel-paths)
4. [Technical Dependencies](#technical-dependencies)
5. [Testing Strategy](#testing-strategy)
6. [Performance Considerations](#performance-considerations)

---

## Phase A: Quick Wins

### Feature 1: Task Highlighting on Map

**Objective:** Provide clear visual indication of which roads have queued or pending repair tasks.

**Effort Estimate:** 2-3 hours

#### Files to Modify
- `apps/web/app/components/DemoMap.tsx`

#### Technical Approach

Add two new MapLibre GL layers to highlight roads with active tasks:

1. **Dashed Line Layer** (`game-roads-task-highlight-dash`)
   - White dashed line pattern
   - Rendered on top of existing road layers
   - Filter: Tasks with `status = 'queued' OR status = 'pending'`

2. **Glow Layer** (`game-roads-task-highlight-glow`)
   - Outer blur effect around highlighted roads
   - Slightly wider than base road
   - Soft white/cyan glow

#### Implementation Steps

1. **Create task ID tracking state:**
   ```typescript
   const [queuedTaskRoadIds, setQueuedTaskRoadIds] = useState<string[]>([]);

   useEffect(() => {
     const ids = region.tasks
       .filter(t => t.status === 'queued' || t.status === 'pending')
       .map(t => t.target_gers_id);
     setQueuedTaskRoadIds(ids);
   }, [region.tasks]);
   ```

2. **Add layers after existing repair-pulse layers:**
   ```typescript
   // Glow layer (underneath)
   map.addLayer({
     id: 'game-roads-task-highlight-glow',
     type: 'line',
     source: 'game-roads',
     filter: ['in', ['get', 'gers_id'], ['literal', queuedTaskRoadIds]],
     paint: {
       'line-color': '#ffffff',
       'line-width': 6,
       'line-blur': 4,
       'line-opacity': 0.3
     }
   });

   // Dashed line layer (on top)
   map.addLayer({
     id: 'game-roads-task-highlight-dash',
     type: 'line',
     source: 'game-roads',
     filter: ['in', ['get', 'gers_id'], ['literal', queuedTaskRoadIds]],
     paint: {
       'line-color': '#ffffff',
       'line-width': 3,
       'line-dasharray': [2, 3],
       'line-opacity': 0.6
     }
   });
   ```

3. **Update filter when queuedTaskRoadIds changes:**
   ```typescript
   useEffect(() => {
     if (!isLoaded) return;

     map.setFilter('game-roads-task-highlight-dash',
       ['in', ['get', 'gers_id'], ['literal', queuedTaskRoadIds]]
     );
     map.setFilter('game-roads-task-highlight-glow',
       ['in', ['get', 'gers_id'], ['literal', queuedTaskRoadIds]]
     );
   }, [queuedTaskRoadIds, isLoaded]);
   ```

#### Design Considerations

- Use distinct visual treatment from repair-pulse (currently active) vs task-highlight (queued)
- Consider color distinction: repair-pulse uses cyan, task-highlight could use white/yellow
- Ensure visibility across all phase filters (dawn/day/dusk/night)
- Z-index: Place above roads but below repair-pulse for clear hierarchy

#### Success Criteria

- [ ] Queued tasks are visually distinct on the map
- [ ] Highlighting updates in real-time when tasks change status
- [ ] No performance degradation with 10+ highlighted roads
- [ ] Visual clarity maintained across all phase transitions

---

### Feature 2: Smoother Phase Transitions

**Objective:** Create more cinematic and gradual transitions between day/night phases with enhanced visual effects.

**Effort Estimate:** 2-3 hours

#### Files to Modify
- `apps/web/app/components/DemoMap.tsx`
- `apps/web/app/components/Dashboard.tsx`
- `apps/web/app/globals.css`

#### Technical Approach

Enhance the existing CSS filter-based phase system with:
1. Longer, smoother easing curves
2. Gradient overlays during transition periods
3. Custom keyframe animations for each phase

#### Implementation Steps

1. **Update CSS filter transition timing** (`DemoMap.tsx`):
   ```typescript
   <div
     className={`map-container phase-${cycle.phase}`}
     style={{
       filter: getPhaseFilter(cycle.phase),
       transition: 'filter 2500ms cubic-bezier(0.4, 0, 0.2, 1)'
     }}
   >
   ```

2. **Add transition gradient overlay** (`DemoMap.tsx`):
   ```typescript
   const isTransitioning = cycle.phase_progress > 0.9; // Last 10% of phase

   <div className="phase-transition-overlay" style={{
     opacity: isTransitioning ? 0.15 : 0,
     background: getTransitionGradient(cycle.phase, cycle.next_phase),
     transition: 'opacity 1000ms ease-in-out'
   }} />
   ```

   ```typescript
   function getTransitionGradient(currentPhase: Phase, nextPhase: Phase): string {
     if (nextPhase === 'night') return 'radial-gradient(circle, transparent 0%, rgba(10, 10, 30, 0.4) 100%)';
     if (nextPhase === 'dawn') return 'radial-gradient(circle, rgba(255, 180, 100, 0.2) 0%, transparent 100%)';
     if (nextPhase === 'day') return 'linear-gradient(to top, transparent 0%, rgba(135, 206, 235, 0.1) 100%)';
     if (nextPhase === 'dusk') return 'linear-gradient(to bottom, rgba(255, 100, 50, 0.2) 0%, transparent 100%)';
     return 'transparent';
   }
   ```

3. **Add keyframe animations** (`globals.css`):
   ```css
   @keyframes dawn-rays {
     0%, 100% { opacity: 0.6; }
     50% { opacity: 0.9; }
   }

   @keyframes night-pulse {
     0%, 100% { opacity: 0.8; }
     50% { opacity: 1; }
   }

   @keyframes dusk-glow {
     0% { opacity: 0.5; }
     100% { opacity: 0.8; }
   }

   @keyframes fade-in-out {
     0%, 100% { opacity: 0; }
     50% { opacity: 1; }
   }

   .phase-dawn::after {
     content: '';
     position: absolute;
     inset: 0;
     pointer-events: none;
     background: radial-gradient(circle at 70% 30%, rgba(255, 200, 100, 0.1) 0%, transparent 60%);
     animation: dawn-rays 8s ease-in-out infinite;
   }

   .phase-night::after {
     content: '';
     position: absolute;
     inset: 0;
     pointer-events: none;
     background: radial-gradient(circle at 50% 50%, rgba(100, 100, 200, 0.05) 0%, transparent 80%);
     animation: night-pulse 6s ease-in-out infinite;
   }

   .phase-transition-overlay {
     position: absolute;
     inset: 0;
     pointer-events: none;
     z-index: 5;
   }
   ```

#### Design Considerations

- Transition timing should feel natural, not jarring
- Gradients should be subtle to avoid obscuring map content
- Animations should be GPU-accelerated (use transform/opacity)
- Consider reduced-motion accessibility preferences

#### Success Criteria

- [ ] Transitions feel smooth and cinematic (2.5s duration)
- [ ] Gradient overlays visible but not distracting
- [ ] No layout shift or flash during transitions
- [ ] Respects `prefers-reduced-motion` media query

---

### Feature 3: Regional Health Ring

**Objective:** Provide at-a-glance regional health metrics through an animated SVG ring visualization.

**Effort Estimate:** 2-3 hours

#### Files to Create
- `apps/web/app/components/RegionalHealthRing.tsx`

#### Files to Modify
- `apps/web/app/components/Dashboard.tsx`

#### Technical Approach

Create a dual-ring SVG component that displays:
- **Outer ring:** Road health percentage (color gradient from red → yellow → green)
- **Inner ring:** Rust level (amber/brown, higher rust = fuller ring)
- **Center text:** Primary metric (health percentage)
- **Position:** Bottom-left corner of map viewport, absolute positioned

#### Implementation Steps

1. **Create RegionalHealthRing component:**
   ```typescript
   // apps/web/app/components/RegionalHealthRing.tsx

   interface RegionalHealthRingProps {
     healthPercent: number;  // 0-100
     rustLevel: number;       // 0-100
   }

   export function RegionalHealthRing({ healthPercent, rustLevel }: RegionalHealthRingProps) {
     const radius = 50;
     const strokeWidth = 8;
     const innerRadius = radius - strokeWidth - 4;
     const innerStrokeWidth = 6;

     const circumference = 2 * Math.PI * radius;
     const healthOffset = circumference - (healthPercent / 100) * circumference;

     const innerCircumference = 2 * Math.PI * innerRadius;
     const rustOffset = innerCircumference - (rustLevel / 100) * innerCircumference;

     const healthColor = getHealthColor(healthPercent);
     const rustColor = getRustColor(rustLevel);

     return (
       <div className="regional-health-ring">
         <svg width="140" height="140" viewBox="0 0 140 140">
           {/* Background rings */}
           <circle
             cx="70"
             cy="70"
             r={radius}
             fill="none"
             stroke="rgba(255,255,255,0.1)"
             strokeWidth={strokeWidth}
           />
           <circle
             cx="70"
             cy="70"
             r={innerRadius}
             fill="none"
             stroke="rgba(255,255,255,0.08)"
             strokeWidth={innerStrokeWidth}
           />

           {/* Outer ring - Health */}
           <circle
             cx="70"
             cy="70"
             r={radius}
             fill="none"
             stroke={healthColor}
             strokeWidth={strokeWidth}
             strokeDasharray={circumference}
             strokeDashoffset={healthOffset}
             strokeLinecap="round"
             transform="rotate(-90 70 70)"
             style={{
               transition: 'stroke-dashoffset 1s ease-out, stroke 0.5s ease-out'
             }}
           />

           {/* Inner ring - Rust */}
           <circle
             cx="70"
             cy="70"
             r={innerRadius}
             fill="none"
             stroke={rustColor}
             strokeWidth={innerStrokeWidth}
             strokeDasharray={innerCircumference}
             strokeDashoffset={rustOffset}
             strokeLinecap="round"
             transform="rotate(-90 70 70)"
             style={{
               transition: 'stroke-dashoffset 1s ease-out'
             }}
           />

           {/* Center text */}
           <text
             x="70"
             y="65"
             textAnchor="middle"
             fontSize="24"
             fontWeight="bold"
             fill={healthColor}
           >
             {Math.round(healthPercent)}%
           </text>
           <text
             x="70"
             y="82"
             textAnchor="middle"
             fontSize="10"
             fill="rgba(255,255,255,0.6)"
           >
             HEALTH
           </text>
         </svg>

         <div className="ring-label">
           <span className="rust-label" style={{ color: rustColor }}>
             Rust: {Math.round(rustLevel)}%
           </span>
         </div>
       </div>
     );
   }

   function getHealthColor(percent: number): string {
     if (percent >= 70) return '#10b981'; // green
     if (percent >= 40) return '#f59e0b'; // amber
     return '#ef4444'; // red
   }

   function getRustColor(percent: number): string {
     if (percent >= 60) return '#92400e'; // dark brown
     if (percent >= 30) return '#d97706'; // amber
     return '#fbbf24'; // light yellow
   }
   ```

2. **Add CSS styling** (`globals.css`):
   ```css
   .regional-health-ring {
     position: absolute;
     bottom: 20px;
     left: 20px;
     z-index: 10;
     background: rgba(25, 23, 16, 0.9);
     border: 1px solid rgba(255, 255, 255, 0.1);
     border-radius: 12px;
     padding: 12px;
     backdrop-filter: blur(8px);
     box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
   }

   .ring-label {
     margin-top: 8px;
     text-align: center;
     font-size: 11px;
     color: rgba(255, 255, 255, 0.7);
   }

   .rust-label {
     font-weight: 500;
   }
   ```

3. **Integrate into Dashboard** (`Dashboard.tsx`):
   ```typescript
   import { RegionalHealthRing } from './RegionalHealthRing';

   // Calculate metrics
   const healthPercent = region.stats.health_avg;
   const rustPercent = region.stats.rust_avg;

   // Add to render (inside map container)
   <RegionalHealthRing
     healthPercent={healthPercent}
     rustLevel={rustPercent}
   />
   ```

#### Design Considerations

- Ring should be visible but not obstruct map controls
- Smooth animations when metrics update (1s transition)
- Color choices should be colorblind-friendly
- Consider mobile positioning (might need to adjust placement)

#### Success Criteria

- [ ] Rings update smoothly when stats change
- [ ] Color gradient clearly indicates health status
- [ ] Readable across all phase filters
- [ ] No overlap with map controls or panels
- [ ] Responsive on mobile (adjusts position/size)

---

## Phase B: Core UX

### Feature 4: Task Management UX

**Objective:** Add filtering, sorting, and search capabilities to the task list for better information discovery.

**Effort Estimate:** 4-5 hours

#### Files to Modify
- `apps/web/app/components/TaskList.tsx`

#### Technical Approach

Enhance the existing task list with:
1. **Search:** Filter tasks by road ID or task type
2. **Filter chips:** Quick filters for task status and priority
3. **Sort options:** Order by priority, votes, cost, or duration
4. **Task count badges:** Show count per filter category

#### Implementation Steps

1. **Add state management:**
   ```typescript
   type TaskFilter = 'all' | 'queued' | 'in_progress' | 'high_priority';
   type TaskSort = 'priority' | 'votes' | 'cost' | 'duration';

   const [searchQuery, setSearchQuery] = useState('');
   const [activeFilter, setActiveFilter] = useState<TaskFilter>('all');
   const [sortBy, setSortBy] = useState<TaskSort>('priority');
   ```

2. **Implement filtering logic:**
   ```typescript
   const filteredTasks = useMemo(() => {
     let result = [...tasks];

     // Search filter
     if (searchQuery) {
       result = result.filter(t =>
         t.target_gers_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
         t.task_type.toLowerCase().includes(searchQuery.toLowerCase())
       );
     }

     // Status/priority filter
     switch (activeFilter) {
       case 'queued':
         result = result.filter(t => t.status === 'queued');
         break;
       case 'in_progress':
         result = result.filter(t => t.status === 'in_progress');
         break;
       case 'high_priority':
         result = result.filter(t => t.priority_score > 70);
         break;
     }

     // Sort
     result.sort((a, b) => {
       switch (sortBy) {
         case 'priority':
           return b.priority_score - a.priority_score;
         case 'votes':
           return b.vote_score - a.vote_score;
         case 'cost':
           return (b.cost_labor + b.cost_materials) - (a.cost_labor + a.cost_materials);
         case 'duration':
           return b.duration_s - a.duration_s;
         default:
           return 0;
       }
     });

     return result;
   }, [tasks, searchQuery, activeFilter, sortBy]);
   ```

3. **Create UI components:**
   ```typescript
   // Search input
   <div className="task-search">
     <SearchIcon className="search-icon" />
     <input
       type="text"
       placeholder="Search tasks..."
       value={searchQuery}
       onChange={(e) => setSearchQuery(e.target.value)}
       className="search-input"
     />
     {searchQuery && (
       <button onClick={() => setSearchQuery('')}>
         <XIcon />
       </button>
     )}
   </div>

   // Filter chips
   <div className="task-filters">
     {(['all', 'queued', 'in_progress', 'high_priority'] as TaskFilter[]).map(filter => {
       const count = getTaskCount(tasks, filter);
       return (
         <button
           key={filter}
           className={`filter-chip ${activeFilter === filter ? 'active' : ''}`}
           onClick={() => setActiveFilter(filter)}
         >
           {formatFilterLabel(filter)}
           <span className="filter-count">{count}</span>
         </button>
       );
     })}
   </div>

   // Sort dropdown
   <select
     value={sortBy}
     onChange={(e) => setSortBy(e.target.value as TaskSort)}
     className="sort-select"
   >
     <option value="priority">Priority</option>
     <option value="votes">Community Votes</option>
     <option value="cost">Total Cost</option>
     <option value="duration">Duration</option>
   </select>
   ```

4. **Add helper functions:**
   ```typescript
   function getTaskCount(tasks: Task[], filter: TaskFilter): number {
     switch (filter) {
       case 'all': return tasks.length;
       case 'queued': return tasks.filter(t => t.status === 'queued').length;
       case 'in_progress': return tasks.filter(t => t.status === 'in_progress').length;
       case 'high_priority': return tasks.filter(t => t.priority_score > 70).length;
     }
   }

   function formatFilterLabel(filter: TaskFilter): string {
     return filter.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
   }
   ```

5. **Add CSS styling** (`globals.css`):
   ```css
   .task-search {
     position: relative;
     margin-bottom: 12px;
   }

   .search-icon {
     position: absolute;
     left: 12px;
     top: 50%;
     transform: translateY(-50%);
     width: 16px;
     height: 16px;
     opacity: 0.5;
   }

   .search-input {
     width: 100%;
     padding: 8px 12px 8px 36px;
     background: rgba(255, 255, 255, 0.05);
     border: 1px solid rgba(255, 255, 255, 0.1);
     border-radius: 6px;
     color: #fff;
     font-size: 14px;
   }

   .task-filters {
     display: flex;
     gap: 8px;
     margin-bottom: 12px;
     flex-wrap: wrap;
   }

   .filter-chip {
     padding: 6px 12px;
     background: rgba(255, 255, 255, 0.05);
     border: 1px solid rgba(255, 255, 255, 0.1);
     border-radius: 16px;
     font-size: 12px;
     color: rgba(255, 255, 255, 0.7);
     cursor: pointer;
     transition: all 0.2s;
     display: flex;
     align-items: center;
     gap: 6px;
   }

   .filter-chip.active {
     background: rgba(62, 176, 192, 0.2);
     border-color: #3eb0c0;
     color: #3eb0c0;
   }

   .filter-count {
     display: inline-flex;
     align-items: center;
     justify-content: center;
     min-width: 18px;
     height: 18px;
     padding: 0 4px;
     background: rgba(255, 255, 255, 0.15);
     border-radius: 9px;
     font-size: 10px;
     font-weight: 600;
   }

   .sort-select {
     width: 100%;
     padding: 8px 12px;
     background: rgba(255, 255, 255, 0.05);
     border: 1px solid rgba(255, 255, 255, 0.1);
     border-radius: 6px;
     color: #fff;
     font-size: 13px;
     margin-bottom: 12px;
   }
   ```

#### Design Considerations

- Search should be debounced to avoid excessive re-renders
- Filters should be keyboard-accessible
- Empty states should be handled gracefully
- Consider persisting filter/sort preferences to localStorage

#### Success Criteria

- [ ] Search filters tasks in real-time
- [ ] Filter chips show accurate task counts
- [ ] Sorting updates list order correctly
- [ ] UI remains responsive with 50+ tasks
- [ ] Keyboard navigation works (Tab, Enter, Escape)

---

### Feature 5: Hover Tooltips

**Objective:** Display contextual information when hovering over map features (roads, buildings, hexes).

**Effort Estimate:** 4-5 hours

#### Files to Create
- `apps/web/app/components/MapTooltip.tsx`

#### Files to Modify
- `apps/web/app/components/DemoMap.tsx`

#### Technical Approach

Create a floating tooltip component that shows detailed information based on the hovered feature type:
- **Roads:** Road class, health %, status
- **Buildings:** Category, resource generation flags
- **Hexes:** Rust level %

Use MapLibre's `queryRenderedFeatures` to detect hovered features and extract properties.

#### Implementation Steps

1. **Create MapTooltip component:**
   ```typescript
   // apps/web/app/components/MapTooltip.tsx

   interface TooltipData {
     type: 'road' | 'building' | 'hex';
     position: { x: number; y: number };
     data: RoadData | BuildingData | HexData;
   }

   interface RoadData {
     road_class: string;
     health: number;
     status: string;
   }

   interface BuildingData {
     category: string;
     generates_labor: boolean;
     generates_materials: boolean;
   }

   interface HexData {
     rust_level: number;
   }

   export function MapTooltip({ tooltip }: { tooltip: TooltipData | null }) {
     if (!tooltip) return null;

     return (
       <div
         className="map-tooltip"
         style={{
           left: tooltip.position.x + 12,
           top: tooltip.position.y - 8,
         }}
       >
         {tooltip.type === 'road' && (
           <RoadTooltipContent data={tooltip.data as RoadData} />
         )}
         {tooltip.type === 'building' && (
           <BuildingTooltipContent data={tooltip.data as BuildingData} />
         )}
         {tooltip.type === 'hex' && (
           <HexTooltipContent data={tooltip.data as HexData} />
         )}
       </div>
     );
   }

   function RoadTooltipContent({ data }: { data: RoadData }) {
     const healthColor = data.health >= 70 ? '#10b981' : data.health >= 40 ? '#f59e0b' : '#ef4444';

     return (
       <>
         <div className="tooltip-header">Road Segment</div>
         <div className="tooltip-row">
           <span className="tooltip-label">Class:</span>
           <span className="tooltip-value">{data.road_class}</span>
         </div>
         <div className="tooltip-row">
           <span className="tooltip-label">Health:</span>
           <span className="tooltip-value" style={{ color: healthColor }}>
             {Math.round(data.health)}%
           </span>
         </div>
         {data.status && (
           <div className="tooltip-row">
             <span className="tooltip-label">Status:</span>
             <span className="tooltip-value status-badge">{data.status}</span>
           </div>
         )}
       </>
     );
   }

   function BuildingTooltipContent({ data }: { data: BuildingData }) {
     return (
       <>
         <div className="tooltip-header">Building</div>
         <div className="tooltip-row">
           <span className="tooltip-label">Category:</span>
           <span className="tooltip-value">{data.category}</span>
         </div>
         {(data.generates_labor || data.generates_materials) && (
           <div className="tooltip-row">
             <span className="tooltip-label">Generates:</span>
             <div className="tooltip-tags">
               {data.generates_labor && <span className="tag labor">Labor</span>}
               {data.generates_materials && <span className="tag materials">Materials</span>}
             </div>
           </div>
         )}
       </>
     );
   }

   function HexTooltipContent({ data }: { data: HexData }) {
     const rustColor = data.rust_level >= 60 ? '#92400e' : data.rust_level >= 30 ? '#d97706' : '#fbbf24';

     return (
       <>
         <div className="tooltip-header">Hex Cell</div>
         <div className="tooltip-row">
           <span className="tooltip-label">Rust Level:</span>
           <span className="tooltip-value" style={{ color: rustColor }}>
             {Math.round(data.rust_level)}%
           </span>
         </div>
       </>
     );
   }
   ```

2. **Add hover detection to DemoMap:**
   ```typescript
   const [tooltipData, setTooltipData] = useState<TooltipData | null>(null);
   const hoverTimeoutRef = useRef<NodeJS.Timeout>();

   useEffect(() => {
     if (!isLoaded) return;

     const handleMouseMove = (e: MapMouseEvent) => {
       const features = map.queryRenderedFeatures(e.point, {
         layers: ['game-roads-line', 'game-buildings', 'game-hexes-fill']
       });

       if (features.length > 0) {
         clearTimeout(hoverTimeoutRef.current);
         hoverTimeoutRef.current = setTimeout(() => {
           const feature = features[0];

           if (feature.layer.id === 'game-roads-line') {
             setTooltipData({
               type: 'road',
               position: { x: e.point.x, y: e.point.y },
               data: {
                 road_class: feature.properties.road_class,
                 health: feature.properties.health,
                 status: feature.properties.status
               }
             });
           } else if (feature.layer.id === 'game-buildings') {
             setTooltipData({
               type: 'building',
               position: { x: e.point.x, y: e.point.y },
               data: {
                 category: feature.properties.place_category,
                 generates_labor: feature.properties.generates_labor,
                 generates_materials: feature.properties.generates_materials
               }
             });
           } else if (feature.layer.id === 'game-hexes-fill') {
             setTooltipData({
               type: 'hex',
               position: { x: e.point.x, y: e.point.y },
               data: {
                 rust_level: feature.properties.rust_level
               }
             });
           }
         }, 200); // 200ms hover delay
       } else {
         setTooltipData(null);
       }
     };

     const handleMouseLeave = () => {
       clearTimeout(hoverTimeoutRef.current);
       setTooltipData(null);
     };

     map.on('mousemove', handleMouseMove);
     map.on('mouseleave', handleMouseLeave);

     return () => {
       map.off('mousemove', handleMouseMove);
       map.off('mouseleave', handleMouseLeave);
       clearTimeout(hoverTimeoutRef.current);
     };
   }, [isLoaded]);
   ```

3. **Add mobile tap support:**
   ```typescript
   const [isMobile, setIsMobile] = useState(false);

   useEffect(() => {
     setIsMobile(window.matchMedia('(max-width: 768px)').matches);
   }, []);

   useEffect(() => {
     if (!isLoaded || !isMobile) return;

     const handleClick = (e: MapMouseEvent) => {
       // Same feature query logic, but triggered by tap
       // Auto-dismiss after 3 seconds
       setTimeout(() => setTooltipData(null), 3000);
     };

     map.on('click', handleClick);
     return () => map.off('click', handleClick);
   }, [isLoaded, isMobile]);
   ```

4. **Add CSS styling** (`globals.css`):
   ```css
   .map-tooltip {
     position: absolute;
     background: rgba(25, 23, 16, 0.95);
     border: 1px solid rgba(255, 255, 255, 0.2);
     border-radius: 8px;
     padding: 12px;
     pointer-events: none;
     z-index: 1000;
     min-width: 180px;
     backdrop-filter: blur(12px);
     box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
     animation: tooltip-fade-in 0.15s ease-out;
   }

   @keyframes tooltip-fade-in {
     from {
       opacity: 0;
       transform: translateY(4px);
     }
     to {
       opacity: 1;
       transform: translateY(0);
     }
   }

   .tooltip-header {
     font-size: 11px;
     text-transform: uppercase;
     letter-spacing: 0.5px;
     color: rgba(255, 255, 255, 0.5);
     margin-bottom: 8px;
     font-weight: 600;
   }

   .tooltip-row {
     display: flex;
     align-items: center;
     justify-content: space-between;
     margin-bottom: 6px;
     font-size: 13px;
   }

   .tooltip-label {
     color: rgba(255, 255, 255, 0.6);
     margin-right: 12px;
   }

   .tooltip-value {
     color: #fff;
     font-weight: 500;
   }

   .status-badge {
     padding: 2px 8px;
     background: rgba(62, 176, 192, 0.2);
     border-radius: 4px;
     font-size: 11px;
   }

   .tooltip-tags {
     display: flex;
     gap: 4px;
   }

   .tag {
     padding: 2px 6px;
     border-radius: 4px;
     font-size: 10px;
     font-weight: 600;
   }

   .tag.labor {
     background: rgba(62, 176, 192, 0.2);
     color: #3eb0c0;
   }

   .tag.materials {
     background: rgba(240, 138, 78, 0.2);
     color: #f08a4e;
   }
   ```

#### Design Considerations

- Tooltips should appear with slight delay (200ms) to avoid flickering
- Position should adjust if near viewport edges
- Mobile: Use tap instead of hover, with auto-dismiss
- Consider throttling mousemove events for performance
- Ensure tooltip doesn't block important UI elements

#### Success Criteria

- [ ] Tooltips appear on hover with 200ms delay
- [ ] Correct data displayed for each feature type
- [ ] Tooltips position dynamically to stay in viewport
- [ ] Mobile tap-to-show works with 3s auto-dismiss
- [ ] No performance degradation when moving cursor rapidly

---

## Phase C: Visual Polish

### Feature 6: Animated Rust Spread

**Objective:** Add a subtle "breathing" animation to rust hexes during night/dusk phases for enhanced atmosphere.

**Effort Estimate:** 3-4 hours

#### Files to Modify
- `apps/web/app/components/DemoMap.tsx`

#### Technical Approach

Use `requestAnimationFrame` to create a sinusoidal opacity pulse on rust hex layers. The animation should:
- Only run during `night` and `dusk` phases
- Pulse between 0.3 and 0.45 opacity
- Have a slow, organic breathing rhythm (~4 second cycle)
- Apply to both hex fill and outline layers

#### Implementation Steps

1. **Create animation state and ref:**
   ```typescript
   const rustAnimationRef = useRef<number>();
   const breathePhaseRef = useRef(0);
   ```

2. **Implement breathing animation loop:**
   ```typescript
   useEffect(() => {
     if (!isLoaded) return;

     const shouldAnimate = cycle.phase === 'night' || cycle.phase === 'dusk';

     if (shouldAnimate) {
       const animate = () => {
         breathePhaseRef.current += 0.015; // ~4 second cycle
         const breatheProgress = Math.sin(breathePhaseRef.current);

         // Map sin wave (-1 to 1) to opacity range (0.3 to 0.45)
         const opacity = 0.375 + 0.075 * breatheProgress;

         // Update hex fill layer
         map.setPaintProperty('game-hexes-fill', 'fill-opacity', opacity);

         // Update hex outline layer (slightly less opacity variation)
         const outlineOpacity = 0.25 + 0.05 * breatheProgress;
         map.setPaintProperty('game-hexes-outline', 'line-opacity', outlineOpacity);

         rustAnimationRef.current = requestAnimationFrame(animate);
       };

       rustAnimationRef.current = requestAnimationFrame(animate);
     } else {
       // Cancel animation and reset to static opacity
       if (rustAnimationRef.current) {
         cancelAnimationFrame(rustAnimationRef.current);
       }

       // Day/dawn: Lower static opacity
       map.setPaintProperty('game-hexes-fill', 'fill-opacity', 0.2);
       map.setPaintProperty('game-hexes-outline', 'line-opacity', 0.15);
     }

     return () => {
       if (rustAnimationRef.current) {
         cancelAnimationFrame(rustAnimationRef.current);
       }
     };
   }, [isLoaded, cycle.phase]);
   ```

3. **Add phase-responsive opacity modifiers:**
   ```typescript
   function getRustOpacityModifier(phase: Phase): number {
     switch (phase) {
       case 'night': return 1.0;   // Full intensity
       case 'dusk': return 0.8;    // Slightly reduced
       case 'dawn': return 0.5;    // Much lower
       case 'day': return 0.4;     // Minimal
       default: return 0.4;
     }
   }

   // Update in animation loop:
   const phaseModifier = getRustOpacityModifier(cycle.phase);
   const opacity = (0.375 + 0.075 * breatheProgress) * phaseModifier;
   ```

4. **Add smooth transition when entering/exiting animation:**
   ```typescript
   useEffect(() => {
     if (!isLoaded) return;

     // Add CSS transition before changing opacity
     map.setPaintProperty('game-hexes-fill', 'fill-opacity-transition', {
       duration: 1000,
       delay: 0
     });
     map.setPaintProperty('game-hexes-outline', 'line-opacity-transition', {
       duration: 1000,
       delay: 0
     });
   }, [isLoaded]);
   ```

#### Design Considerations

- Use `requestAnimationFrame` instead of `setInterval` for smoother animation
- Cancel animation when component unmounts to prevent memory leaks
- Consider battery impact on mobile (might add pause-on-low-battery logic)
- Breathing should be subtle, not distracting

#### Success Criteria

- [ ] Rust hexes pulse smoothly during night/dusk
- [ ] Animation stops during day/dawn phases
- [ ] No memory leaks or runaway animations
- [ ] Smooth transition when entering/exiting animation
- [ ] Performance remains stable (60fps)

---

### Feature 7: Crew Travel Paths

**Objective:** Visualize crew movement with animated paths from hub buildings to task locations.

**Effort Estimate:** 4-6 hours

#### Files to Modify
- `apps/web/app/components/DemoMap.tsx`
- `apps/web/app/lib/resourceAnimation.ts`

#### Technical Approach

Create animated dotted lines that show crew travel paths:
1. **Calculate path:** Use `buildResourcePath` utility to create road-following route
2. **Animate dash offset:** Create moving dashed line effect
3. **Animate marker:** Show crew position along path using `busy_until` timestamp
4. **Update in real-time:** Respond to crew status changes from SSE

#### Implementation Steps

1. **Add crew path state:**
   ```typescript
   type CrewPath = {
     crew_id: string;
     path: [number, number][];
     startTime: number;
     endTime: number;
     status: 'traveling' | 'working';
   };

   const [crewPaths, setCrewPaths] = useState<CrewPath[]>([]);
   ```

2. **Calculate crew paths when tasks start:**
   ```typescript
   useEffect(() => {
     const paths: CrewPath[] = [];

     region.crews.forEach(crew => {
       if (crew.status === 'traveling' && crew.active_task_id) {
         const task = region.tasks.find(t => t.task_id === crew.active_task_id);
         if (!task) return;

         // Find source (hub building or region center)
         const source = findNearestHubBuilding(region.boundary);

         // Find destination (task target road centroid)
         const destination = getFeatureCentroid(task.target_gers_id);

         if (source && destination) {
           const path = buildResourcePath(source, destination, features);
           const now = Date.now();
           const busyUntil = crew.busy_until ? new Date(crew.busy_until).getTime() : now + 10000;

           paths.push({
             crew_id: crew.crew_id,
             path: path.map(p => [p.lng, p.lat]),
             startTime: now,
             endTime: busyUntil,
             status: 'traveling'
           });
         }
       }
     });

     setCrewPaths(paths);
   }, [region.crews, region.tasks, features]);
   ```

3. **Create GeoJSON source and layers:**
   ```typescript
   useEffect(() => {
     if (!isLoaded) return;

     // Add source
     if (!map.getSource('game-crew-paths')) {
       map.addSource('game-crew-paths', {
         type: 'geojson',
         data: {
           type: 'FeatureCollection',
           features: crewPaths.map(cp => ({
             type: 'Feature',
             properties: { crew_id: cp.crew_id },
             geometry: {
               type: 'LineString',
               coordinates: cp.path
             }
           }))
         }
       });

       // Add dashed line layer
       map.addLayer({
         id: 'game-crew-path-line',
         type: 'line',
         source: 'game-crew-paths',
         paint: {
           'line-color': '#f0ddc2',
           'line-width': 2,
           'line-dasharray': [2, 2],
           'line-opacity': 0.6
         }
       });

       // Add crew marker layer
       map.addSource('game-crew-markers', {
         type: 'geojson',
         data: {
           type: 'FeatureCollection',
           features: []
         }
       });

       map.addLayer({
         id: 'game-crew-path-head',
         type: 'circle',
         source: 'game-crew-markers',
         paint: {
           'circle-radius': 6,
           'circle-color': '#f0ddc2',
           'circle-stroke-width': 2,
           'circle-stroke-color': '#fff',
           'circle-opacity': 0.9
         }
       });
     } else {
       // Update existing source
       const source = map.getSource('game-crew-paths') as maplibregl.GeoJSONSource;
       source.setData({
         type: 'FeatureCollection',
         features: crewPaths.map(cp => ({
           type: 'Feature',
           properties: { crew_id: cp.crew_id },
           geometry: {
             type: 'LineString',
             coordinates: cp.path
           }
         }))
       });
     }
   }, [crewPaths, isLoaded]);
   ```

4. **Animate dash offset and crew markers:**
   ```typescript
   const crewAnimationRef = useRef<number>();

   useEffect(() => {
     if (!isLoaded || crewPaths.length === 0) return;

     let dashOffset = 0;

     const animate = () => {
       const now = Date.now();

       // Animate dash offset
       dashOffset = (dashOffset + 0.5) % 8;
       map.setPaintProperty('game-crew-path-line', 'line-dasharray', [2, 2, dashOffset]);

       // Update crew marker positions
       const markerFeatures = crewPaths.map(cp => {
         const progress = (now - cp.startTime) / (cp.endTime - cp.startTime);
         const clampedProgress = Math.max(0, Math.min(1, progress));

         const position = interpolatePath(
           cp.path.map(([lng, lat]) => ({ lng, lat })),
           clampedProgress
         );

         return {
           type: 'Feature',
           properties: { crew_id: cp.crew_id },
           geometry: {
             type: 'Point',
             coordinates: [position.lng, position.lat]
           }
         };
       });

       const markerSource = map.getSource('game-crew-markers') as maplibregl.GeoJSONSource;
       markerSource.setData({
         type: 'FeatureCollection',
         features: markerFeatures
       });

       crewAnimationRef.current = requestAnimationFrame(animate);
     };

     crewAnimationRef.current = requestAnimationFrame(animate);

     return () => {
       if (crewAnimationRef.current) {
         cancelAnimationFrame(crewAnimationRef.current);
       }
     };
   }, [crewPaths, isLoaded]);
   ```

5. **Add helper functions to resourceAnimation.ts:**
   ```typescript
   // Already exists, but ensure it handles LineString paths
   export function interpolatePath(path: Point[], progress: number): Point {
     const totalSegments = path.length - 1;
     const segmentIndex = Math.floor(progress * totalSegments);
     const segmentProgress = (progress * totalSegments) - segmentIndex;

     if (segmentIndex >= totalSegments) {
       return path[path.length - 1];
     }

     const start = path[segmentIndex];
     const end = path[segmentIndex + 1];

     return {
       lng: start.lng + (end.lng - start.lng) * segmentProgress,
       lat: start.lat + (end.lat - start.lat) * segmentProgress
     };
   }
   ```

#### Design Considerations

- Paths should follow existing road network (use A* pathfinding)
- Animation should be smooth (60fps) even with multiple crews
- Consider crew status colors (traveling = yellow, working = cyan)
- Remove paths when crew reaches destination or task is cancelled
- Mobile performance: Limit max concurrent animated paths

#### Success Criteria

- [ ] Crew paths appear when tasks are assigned
- [ ] Dash animation creates smooth "traveling" effect
- [ ] Crew markers move along path based on busy_until timestamp
- [ ] Paths update in real-time from SSE events
- [ ] No performance issues with 5+ concurrent paths
- [ ] Paths removed when crews complete tasks

---

## Technical Dependencies

### NPM Packages (Already Installed)
- `maplibre-gl` - Map rendering and layer management
- `zustand` - State management
- `sonner` - Toast notifications
- `h3-js` - H3 hexagonal grid utilities
- `next` - React framework

### Browser APIs
- `requestAnimationFrame` - Smooth animations
- `CustomEvent` - Cross-component communication
- `matchMedia` - Mobile/desktop detection

### Internal Dependencies
- `apps/web/app/store.ts` - Global state (regions, features, hexes, cycle, crews, tasks)
- `apps/web/app/lib/resourceAnimation.ts` - Pathfinding utilities
- `apps/api/src/server.ts` - SSE events (task_delta, crew_delta, feature_delta)

---

## Testing Strategy

### Unit Tests
- `resourceAnimation.ts` pathfinding functions
- Filter/sort/search logic in TaskList
- Tooltip data transformation functions
- Health/rust color calculation functions

### Integration Tests
- SSE event handling triggers correct state updates
- Map layers update when filters change
- Animations start/stop correctly based on phase
- Toast notifications appear for appropriate events

### Visual Regression Tests
- Screenshot tests for each phase filter
- Tooltip positioning across viewport edges
- Health ring color gradients
- Task highlight appearance

### Performance Tests
- FPS monitoring with 50+ features
- Memory leak detection (animation cleanup)
- Mobile responsiveness (touch events)
- Bundle size impact

### Manual Testing Checklist
- [ ] Task highlighting visible across all phases
- [ ] Phase transitions feel smooth (no flicker)
- [ ] Health ring updates in real-time
- [ ] Task filters work correctly
- [ ] Tooltips position correctly
- [ ] Rust breathing animation only during night/dusk
- [ ] Crew paths animate smoothly
- [ ] Mobile touch interactions work
- [ ] Accessibility (keyboard nav, screen readers)

---

## Performance Considerations

### Optimization Strategies

1. **Layer Rendering**
   - Use MapLibre's built-in filtering instead of recreating layers
   - Minimize layer count (combine where possible)
   - Use `setPaintProperty` instead of removing/re-adding layers

2. **Animation Performance**
   - Use `requestAnimationFrame` instead of intervals
   - Cancel animations on unmount to prevent leaks
   - Throttle/debounce mouse events (tooltip triggers)
   - Use CSS transitions where possible (GPU-accelerated)

3. **State Management**
   - Memoize filtered/sorted task lists
   - Avoid unnecessary re-renders (React.memo, useMemo, useCallback)
   - Batch state updates when possible

4. **Memory Management**
   - Clean up event listeners on unmount
   - Cancel pending timeouts/animations
   - Limit toast notification queue (50 max)
   - Remove completed crew paths from state

5. **Mobile Optimizations**
   - Reduce animation complexity on lower-end devices
   - Use `matchMedia` to detect mobile and adjust features
   - Consider disabling expensive effects on battery saver mode
   - Debounce touch events more aggressively than mouse

### Performance Budgets

- **FPS Target:** 60fps minimum for all animations
- **Memory:** No memory leaks over 5-minute session
- **Bundle Size:** < 50KB additional JS for all features
- **Time to Interactive:** No degradation from current baseline

---

## Implementation Notes

### Development Workflow

1. Create feature branch for each phase
2. Implement features in order (Phase A → B → C)
3. Test each feature individually before moving to next
4. Review with user after each phase completion
5. Merge to main only after testing

### Code Style

- Use TypeScript strict mode
- Follow existing component patterns
- Add JSDoc comments for complex functions
- Use semantic color variables (not hardcoded hex)
- Keep components focused (single responsibility)

### Git Commit Strategy

- One commit per feature (atomic)
- Descriptive commit messages following conventional commits
- Include before/after screenshots for visual changes

### Accessibility Considerations

- Respect `prefers-reduced-motion` for animations
- Ensure keyboard navigation works for all interactive elements
- Add ARIA labels to custom controls
- Maintain color contrast ratios (WCAG AA minimum)
- Test with screen reader (VoiceOver/NVDA)

---

## Future Enhancements (Out of Scope)

Ideas to consider after initial implementation:

- **Heatmaps:** Show historical rust spread patterns
- **Time-lapse:** Playback of region evolution over time
- **3D terrain:** Elevation-based building/road rendering
- **Multiplayer cursors:** See other players' selections in real-time
- **Mini-map:** Overview of full region with current viewport indicator
- **Custom themes:** Allow users to customize color schemes
- **Sound effects:** Audio feedback for task completion, phase changes
- **Statistics dashboard:** Charts/graphs of region metrics over time

---

## Questions for User

Before implementation begins, clarify:

1. Should task highlighting differentiate between `queued` and `pending` statuses?
2. Preferred position for Regional Health Ring on mobile?
3. Should crew paths show all crews or only currently traveling ones?
4. Maximum number of toast notifications to show simultaneously?
5. Should tooltips work inside FeaturePanel or only on map?

---

## Acceptance Criteria Summary

**Phase A Complete When:**
- Task highlighting shows queued/pending tasks with dashed outline + glow
- Phase transitions are smooth with 2.5s duration and gradient overlays
- Regional Health Ring displays and updates in real-time

**Phase B Complete When:**
- Task list supports search, filter chips, and sorting
- Tooltips appear on hover (desktop) and tap (mobile) with correct data

**Phase C Complete When:**
- Rust hexes breathe during night/dusk phases
- Crew paths animate smoothly from hub to task location

**Overall Success:**
- All features implemented without performance degradation
- User feedback incorporated
- Visual consistency maintained across all phases
- Mobile experience is responsive and smooth
- No regressions in existing functionality

---

**End of Plan**
