// 文件: school.js
// 中国石油大学(北京)拾光课程表适配脚本
// https://gmis.cup.edu.cn/gmis/student/default/index
// 教务平台：南京南软
// 适配开发者：larryyan

// ==========================================
// 1. 全局配置与工具类
// ==========================================

const CONFIG = {
    campuses: {
        MainCampus: {
            name: "主校区",
            starts: { morning: "08:00", afternoon: "13:30", evening: "18:30" },
            counts: { morning: 4, afternoon: 4, evening: 3 },
            breaks: { short: 5, long: 30, longAfter: { morning: 2, afternoon: 2, evening: 0 } },
            classMins: 45
        },
        Karamay: {
            name: "克拉玛依校区",
            starts: { morning: "09:30", afternoon: "16:00", evening: "20:30" },
            counts: { morning: 5, afternoon: 4, evening: 3 },
            breaks: { short: 5, long: 20, longAfter: { morning: 2, afternoon: 2, evening: 0 } },
            classMins: 45
        }
    }
};

const Utils = {
    toast: (msg) => { if (typeof AndroidBridge !== 'undefined') AndroidBridge.showToast(msg); },
    timeToMins: (timeStr) => { const [h, m] = timeStr.split(':').map(Number); return h * 60 + m; },
    minsToTime: (mins) => `${Math.floor(mins / 60).toString().padStart(2, '0')}:${(mins % 60).toString().padStart(2, '0')}`,
    parseWeeks: (weekStr) => {
        let weeks = [];
        let isSingle = weekStr.includes('单'), isDouble = weekStr.includes('双');
        (weekStr.match(/\d+-\d+|\d+/g) || []).forEach(m => {
            let [start, end] = m.includes('-') ? m.split('-').map(Number) : [Number(m), Number(m)];
            for (let i = start; i <= end; i++) {
                if ((isSingle && i % 2 === 0) || (isDouble && i % 2 !== 0)) continue;
                weeks.push(i);
            }
        });
        return [...new Set(weeks)].sort((a, b) => a - b);
    }
};

function validateDateInput(input) {
    return /^\d{4}[-\/\.]\d{2}[-\/\.]\d{2}$/.test(input) ? false : "格式错误，例: 2025-09-01";
}

// ==========================================
// 2. 核心业务流程 (精简版)
// ==========================================

async function selectCampus() {
    const ids = Object.keys(CONFIG.campuses);
    const labels = ids.map(id => CONFIG.campuses[id].name);
    const index = await window.AndroidBridgePromise.showSingleSelection("选择所在校区", JSON.stringify(labels), 0);
    return index !== null ? ids[index] : null;
}

async function getTermCode() {
    if (typeof $ === 'undefined') throw new Error("缺少环境，请在课表页执行");
    const data = await $.ajax({ type: 'get', url: '/gmis/default/bindterm', dataType: 'json', cache: false });
    if (!data || !data.length) throw new Error("获取学期列表失败");

    const texts = data.map(i => i.termname);
    const codes = data.map(i => i.termcode);
    const defaultIdx = data.findIndex(i => i.selected) || 0;

    const index = await window.AndroidBridgePromise.showSingleSelection("选择导入学期", JSON.stringify(texts), defaultIdx);
    return index !== null ? codes[index] : null;
}

async function fetchCourseData(termCode) {
    Utils.toast("正在解析数据...");
    const data = await $.ajax({ type: 'post', url: "py_kbcx_ew", data: { kblx: 'xs', termcode: termCode }, dataType: 'json', cache: false });
    if (!data || !data.rows) throw new Error("接口数据异常");
    return data.rows;
}

async function processAndSaveCourses(rawData, campusId) {
    const isKaramay = campusId === "Karamay";
    let allBlocks = [], mergedCourses = [];

    const getSec = (jcid) => {
        if (jcid >= 11 && jcid <= 15) return jcid - 10;
        if (jcid >= 21 && jcid <= 24) return jcid - 20 + (isKaramay ? 5 : 4);
        if (jcid >= 31 && jcid <= 33) return jcid - 30 + (isKaramay ? 9 : 8);
        return 1;
    };

    rawData.forEach(row => {
        if (!isKaramay && row.jcid === 15) return;
        const currentSec = getSec(row.jcid);
        for (let d = 1; d <= 7; d++) {
            if (!row['z' + d]) continue;
            row['z' + d].split(/<br\s*\/?>/i).forEach(part => {
                const match = part.match(/(.*?)\[(.*?)\]([^\[]*)(?:\[(.*?)\])?$/);
                if (match) allBlocks.push({ name: match[1].trim(), weekStr: match[2].trim(), weeks: Utils.parseWeeks(match[2]), teacher: (match[3] || "").trim(), position: (match[4] || "未知地点").trim(), day: d, section: currentSec });
            });
        }
    });

    allBlocks.forEach(b => {
        let exist = mergedCourses.find(c => c.day === b.day && c.name === b.name && c.teacher === b.teacher && c.weekStr === b.weekStr && c.endSection === b.section - 1);
        exist ? exist.endSection = b.section : mergedCourses.push({ ...b, startSection: b.section, endSection: b.section });
    });

    mergedCourses.forEach(c => delete c.weekStr);
    
    if (!(await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(mergedCourses)))) {
        throw new Error("课程保存失败");
    }
}

async function generateAndSaveTimeSlots(campusId) {
    const c = CONFIG.campuses[campusId];
    let slots = [], secNum = 1;

    ["morning", "afternoon", "evening"].forEach(period => {
        let mins = Utils.timeToMins(c.starts[period]);
        for (let i = 1; i <= c.counts[period]; i++) {
            const start = Utils.minsToTime(mins);
            mins += c.classMins;
            slots.push({ number: secNum++, startTime: start, endTime: Utils.minsToTime(mins) });
            if (i < c.counts[period]) mins += (i === c.breaks.longAfter[period] ? c.breaks.long : c.breaks.short);
        }
    });

    if (!(await window.AndroidBridgePromise.savePresetTimeSlots(JSON.stringify(slots)))) {
        throw new Error("时间段保存失败");
    }
}

async function promptAndSaveConfig() {
    let date = await window.AndroidBridgePromise.showPrompt("输入开学日期", "格式: YYYY-MM-DD", "2026-03-09", "validateDateInput");
    date = date ? date.trim().replace(/[\/\.]/g, '-') : "2026-03-09";

    const cfg = { semesterStartDate: date, semesterTotalWeeks: 25, defaultClassDuration: 45, defaultBreakDuration: 5, firstDayOfWeek: 1 };
    if (!(await window.AndroidBridgePromise.saveCourseConfig(JSON.stringify(cfg)))) {
        throw new Error("配置保存失败");
    }
}

// ==========================================
// 3. 主流程引擎 (集中错误处理)
// ==========================================

async function runImportFlow() {
    try {
        if (!(await window.AndroidBridgePromise.showAlert("导入通知", "请确保已在网页查看到课表。", "开始"))) return;
        
        const campusId = await selectCampus();
        if (!campusId) return;

        const termCode = await getTermCode();
        if (!termCode) return;

        const rawData = await fetchCourseData(termCode);
        
        await processAndSaveCourses(rawData, campusId);
        await generateAndSaveTimeSlots(campusId);
        await promptAndSaveConfig();

        Utils.toast("🎉 课表导入成功！");
        if (typeof AndroidBridge !== 'undefined') AndroidBridge.notifyTaskCompletion();

    } catch (err) {
        console.error("流程中止:", err);
        Utils.toast("导入中断: " + err.message);
    }
}

runImportFlow();