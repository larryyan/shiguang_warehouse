// resources/CUP/cup_02.js

// 1. 显示一个公告信息弹窗
async function promptUserToStart() {
    try {
        console.log("即将显示公告弹窗...");
        const confirmed = await window.AndroidBridgePromise.showAlert(
            "重要通知",
            "导入前请确保您已成功登录教务系统，并选定正确的学期。",
            "好的，开始"
        );
        if (confirmed) {
            console.log("用户点击了确认按钮。Alert Promise Resolved: " + confirmed);
            AndroidBridge.showToast("Alert：用户点击了确认！");
            return true; // 成功时返回 true
        } else {
            console.log("用户点击了取消按钮或关闭了弹窗。Alert Promise Resolved: " + confirmed);
            AndroidBridge.showToast("Alert：用户取消了！");
            return false; // 用户取消时返回 false
        }
    } catch (error) {
        console.error("显示公告弹窗时发生错误:", error);
        AndroidBridge.showToast("Alert：显示弹窗出错！" + error.message);
        return false; // 出现错误时也返回 false
    }
}

// 2. 选择校区
async function selectCampus() {
    try {
        const campuses = ["本校", "克拉玛依校区"];
        
        // 呼叫安卓原生弹窗
        const selectedIndex = await window.AndroidBridgePromise.showSingleSelection(
            "选择所在校区", 
            JSON.stringify(campuses), 
            0 // 默认选中第一个（本校）
        );

        if (selectedIndex !== null && selectedIndex >= 0) {
            const selectedCampus = campuses[selectedIndex];
            if (typeof AndroidBridge !== 'undefined' && AndroidBridge.showToast) {
                AndroidBridge.showToast("已选择: " + selectedCampus);
            }
            // 返回 true 代表是克拉玛依校区，返回 false 代表是本校
            return selectedIndex === 1; 
        } else {
            // 用户取消了选择
            if (typeof AndroidBridge !== 'undefined' && AndroidBridge.showToast) {
                AndroidBridge.showToast("取消导入：未选择校区。");
            }
            return null;
        }
    } catch (error) {
        console.error("选择校区时发生错误:", error);
        return null; 
    }    
}

// 3. 获取学期信息
async function getTermCode() {
    try {
        if (typeof AndroidBridge !== 'undefined') AndroidBridge.showToast("正在获取学期列表...");

        // 检查环境是否支持 jQuery
        if (typeof $ === 'undefined' || !$.ajax) {
            throw new Error("未检测到 jQuery 环境，请确保在正确的课表页面执行。");
        }

        // 1. 请求学期列表数据
        const termData = await new Promise((resolve, reject) => {
            $.ajax({
                type: 'get',
                dataType: 'json',
                url: '/gmis/default/bindterm',
                cache: false, // 自动附加时间戳防止缓存
                success: function (data) {
                    resolve(data);
                },
                error: function (xhr, status, error) {
                    reject(new Error(`网络请求失败，状态码: ${xhr.status} ${error}`));
                }
            });
        });

        if (!termData || termData.length === 0) {
            throw new Error("未能获取到有效的学期列表数据。");
        }

        // 2. 提取文本、值，并寻找当前默认学期的索引
        const semesterTexts = [];
        const semesterValues = [];
        let defaultSelectedIndex = 0; // 默认选中第一项

        termData.forEach((item, index) => {
            semesterTexts.push(item.termname);
            semesterValues.push(item.termcode);
            // 如果数据中带有 selected: true，则将其设为默认选中
            if (item.selected) {
                defaultSelectedIndex = index;
            }
        });

        // 3. 呼叫安卓原生弹窗
        const selectedIndex = await window.AndroidBridgePromise.showSingleSelection(
            "选择导入学期", 
            JSON.stringify(semesterTexts), 
            defaultSelectedIndex
        );

        // 4. 判断用户选择结果
        if (selectedIndex !== null && selectedIndex >= 0) {
            const selectedValue = semesterValues[selectedIndex];
            if (typeof AndroidBridge !== 'undefined' && AndroidBridge.showToast) {
                AndroidBridge.showToast("已选择学期: " + semesterTexts[selectedIndex]);
            }
            return selectedValue; 
        } else {
            // 用户取消了选择
            if (typeof AndroidBridge !== 'undefined' && AndroidBridge.showToast) {
                AndroidBridge.showToast("取消导入：未选择学期。");
            }
            return null;
        }

    } catch (error) {
        console.error("读取学期信息时发生错误:", error);
        if (typeof AndroidBridge !== 'undefined' && AndroidBridge.showToast) {
            AndroidBridge.showToast("Alert：读取学期信息出错！" + error.message);
        }
        return null; 
    }    
}

// 4. 获取课程数据
async function fetchData(termCode) {
    try {
        // 检查环境是否支持 jQuery 拦截解密
        if (typeof $ === 'undefined' || !$.ajax) {
            throw new Error("未检测到 jQuery 环境，请确保在正确的课表页面执行。");
        }

        // 将 $.ajax 包装成标准的 Promise，无缝融入 async/await 流程
        const response = await new Promise((resolve, reject) => {
            $.ajax({
                type: 'post',
                dataType: 'json',
                url: "../pygl/py_kbcx_ew",
                data: { 'kblx': 'xs', 'termcode': termCode },
                cache: false,
                success: function (data) {
                    resolve(data);
                },
                error: function (xhr, status, error) {
                    reject(new Error(`网络请求失败，状态码: ${xhr.status} ${error}`));
                }
            });
        });

        // 校验返回的数据结构
        if (!response || !response.rows) {
            throw new Error("接口返回数据为空或解密后格式不正确");
        }

        return response.rows;

    } catch (error) {
        console.error("获取数据时发生错误:", error);
        AndroidBridge.showToast("Alert：获取数据出错！" + error.message);
        return null;
    }
}

// 5. 导入课程数据
async function parseCourses(py_kbcx_ew, isKaramayCampus) {
    console.log("正在解析研究生课程数据...");
    
    // 用于存放每一小节课的临时数组
    let allCourseBlocks = [];

    // 辅助函数 1：将 jcid 转换为标准的拾光节次 (1~12节)
    // 根据数据：上午11-15 -> 1-5节，下午21-24 -> 6-9节，晚上31-33 -> 10-12节
    function getStandardSection(jcid) {
        if (jcid >= 11 && jcid <= 15) return jcid - 10;
        if (jcid >= 21 && jcid <= 24) return jcid - 20 + 5; 
        if (jcid >= 31 && jcid <= 33) return jcid - 30 + 9;
        return 1; // 默认兜底
    }

    // 辅助函数 2：解析类似 "连续周 1-12周" 或 "单周 1-11周" 的字符串，返回数字数组
    function parseWeeks(weekStr) {
        let weeks = [];
        let isSingle = weekStr.includes('单');
        let isDouble = weekStr.includes('双');

        // 匹配字符串里的所有数字或数字范围 (如 "1", "1-12")
        let matches = weekStr.match(/\d+-\d+|\d+/g);
        if (matches) {
            matches.forEach(m => {
                if (m.includes('-')) {
                    let [start, end] = m.split('-').map(Number);
                    for (let i = start; i <= end; i++) {
                        if (isSingle && i % 2 === 0) continue;
                        if (isDouble && i % 2 !== 0) continue;
                        weeks.push(i);
                    }
                } else {
                    let w = Number(m);
                    if (isSingle && w % 2 === 0) return;
                    if (isDouble && w % 2 !== 0) return;
                    weeks.push(w);
                }
            });
        }
        return [...new Set(weeks)].sort((a, b) => a - b);
    }

    // --- 第一步：将按“行”排列的数据，拆解提取出每一小节课 ---
    py_kbcx_ew.forEach(row => {
        if (!isKaramayCampus && row.jcid === 15) {
            return; 
        }

        let currentSection = getStandardSection(row.jcid);
        // 遍历星期一 (z1) 到星期日 (z7)
        for (let day = 1; day <= 7; day++) {
            let zVal = row['z' + day];
            if (zVal) {
                // 如果同一个时间有两门课（比如单双周不同），按 <br/> 拆分
                let classParts = zVal.split(/<br\s*\/?>/i); 
                
                classParts.forEach(part => {
                    // 核心正则表达式：匹配 "课程名[周次]老师[地点]"
                    // 兼容没有老师或没有地点的情况
                    let match = part.match(/(.*?)\[(.*?)\]([^\[]*)(?:\[(.*?)\])?$/);
                    
                    if (match) {
                        allCourseBlocks.push({
                            name: match[1].trim(),                   // 提取：课程名
                            weekStr: match[2].trim(),                // 提取：原始周次字符串 (用于后续比对)
                            weeks: parseWeeks(match[2]),             // 解析：纯数字周次数组
                            teacher: match[3] ? match[3].trim() : "",// 提取：老师
                            position: match[4] ? match[4].trim() : "未知地点", // 提取：上课地点
                            day: day,                                // 星期几
                            section: currentSection                  // 当前是第几节
                        });
                    }
                });
            }
        }
    });

    // --- 第二步：将连续的小节课“合并”成一门完整的课 ---
    let mergedCourses = [];
    allCourseBlocks.forEach(block => {
        // 寻找是否已经有相邻的课可以合并 (同星期、同课名、同老师、同地点、同周次，且节次刚好挨着)
        let existingCourse = mergedCourses.find(c => 
            c.day === block.day &&
            c.name === block.name &&
            c.teacher === block.teacher &&
            c.position === block.position &&
            c.weekStr === block.weekStr &&
            c.endSection === block.section - 1 // 核心：判断是否紧挨着上一节
        );

        if (existingCourse) {
            // 如果可以合并，就把结束节次往后延
            existingCourse.endSection = block.section;
        } else {
            // 如果不能合并，就作为一门新课加入
            mergedCourses.push({
                name: block.name,
                teacher: block.teacher,
                position: block.position,
                day: block.day,
                startSection: block.section,
                endSection: block.section,
                weeks: block.weeks,
                weekStr: block.weekStr // 保留用于比对合并
            });
        }
    });

    // 清理掉多余的辅助比对字段，输出最终给拾光 App 的标准格式
    const finalCourses = mergedCourses.map(c => {
        delete c.weekStr; 
        return c;
    });

    console.log("最终生成的标准课表数据：", finalCourses);

    try {
        console.log("正在尝试导入课程...");
        const result = await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(finalCourses));
        if (result === true) {
            console.log("课程导入成功！");
            AndroidBridge.showToast("测试课程导入成功！");
        } else {
            console.log("课程导入未成功，结果：" + result);
            AndroidBridge.showToast("测试课程导入失败，请查看日志。");
        }
    } catch (error) {
        console.error("导入课程时发生错误:", error);
        AndroidBridge.showToast("导入课程失败: " + error.message);
    }
}

// 6. 导入预设时间段
async function importPresetTimeSlots(campusIsKaramay) {
    console.log("正在准备预设时间段数据...");
    const presetTimeSlots = [
        { "number": 1, "startTime": "08:00", "endTime": "08:45" },
        { "number": 2, "startTime": "08:50", "endTime": "09:35" },
        { "number": 3, "startTime": "10:05", "endTime": "10:50" },
        { "number": 4, "startTime": "10:55", "endTime": "11:40" },
        { "number": 5, "startTime": "13:30", "endTime": "14:15" },
        { "number": 6, "startTime": "14:20", "endTime": "15:05" },
        { "number": 7, "startTime": "15:35", "endTime": "16:20" },
        { "number": 8, "startTime": "16:25", "endTime": "17:10" },
        { "number": 9, "startTime": "18:30", "endTime": "19:15" },
        { "number": 10, "startTime": "19:20", "endTime": "20:05" },
        { "number": 11, "startTime": "20:10", "endTime": "20:55" },
        { "number": 12, "startTime": "21:00", "endTime": "21:45" }
    ];

    const presetTimeSlotsKaramay = [
        { "number": 1, "startTime": "08:00", "endTime": "08:45" },
        { "number": 2, "startTime": "08:50", "endTime": "09:35" },
        { "number": 3, "startTime": "10:05", "endTime": "10:50" },
        { "number": 4, "startTime": "10:55", "endTime": "11:40" },
        { "number": 5, "startTime": "12:00", "endTime": "12:45" },
        { "number": 6, "startTime": "13:30", "endTime": "14:15" },
        { "number": 7, "startTime": "14:20", "endTime": "15:05" },
        { "number": 8, "startTime": "15:35", "endTime": "16:20" },
        { "number": 9, "startTime": "16:25", "endTime": "17:10" },
        { "number": 10, "startTime": "18:30", "endTime": "19:15" },
        { "number": 11, "startTime": "19:20", "endTime": "20:05" },
        { "number": 12, "startTime": "20:10", "endTime": "20:55" },
        { "number": 13, "startTime": "21:00", "endTime": "21:45" }
    ];

    try {
        console.log("正在尝试导入预设时间段...");
        const result = await window.AndroidBridgePromise.savePresetTimeSlots(JSON.stringify(campusIsKaramay ? presetTimeSlotsKaramay : presetTimeSlots));
        if (result === true) {
            console.log("预设时间段导入成功！");
            window.AndroidBridge.showToast("测试时间段导入成功！");
        } else {
            console.log("预设时间段导入未成功，结果：" + result);
            window.AndroidBridge.showToast("测试时间段导入失败，请查看日志。");
        }
    } catch (error) {
        console.error("导入时间段时发生错误:", error);
        window.AndroidBridge.showToast("导入时间段失败: " + error.message);
    }
}

/**
 * 验证开学日期的输入格式
 * 规范：验证通过返回 false，验证失败返回 错误信息字符串
 */
function validateDateInput(input) {
    // 匹配 YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD 格式
    if (/^\d{4}[-\/\.]\d{2}[-\/\.]\d{2}$/.test(input)) {
        return false; // 验证通过
    } else {
        return "请输入正确的日期格式，例如: 2025-09-01"; // 验证失败，原生 UI 会显示此提示
    }
}

// 7. 导入课表配置
async function saveConfig() {
    console.log("正在准备配置数据...");

    let startDate = await window.AndroidBridgePromise.showPrompt(
        "输入开学日期", 
        "请输入本学期开学日期 (格式: YYYY-MM-DD):",
        "2025-09-01",          // 默认文本，给用户一个参考
        "validateDateInput"    // 传入我们上面定义的全局验证函数名
    );

    // 如果返回 null，说明用户点击了取消
    if (startDate === null) {
        if (typeof AndroidBridge !== 'undefined') {
            AndroidBridge.showToast("已取消开学日期设置，将使用默认配置。");
        }
        startDate = "2025-09-01"; // 兜底默认值，保证流程继续
    } else {
        // 容错处理：验证函数放过了 / 和 . ，我们在保存前把它统一替换成标准的横杠 -
        startDate = startDate.trim().replace(/[\/\.]/g, '-');
    }

    // 注意：只传入要修改的字段，其他字段（如 semesterTotalWeeks）会使用 Kotlin 模型中的默认值
    const courseConfigData = {
        "semesterStartDate": startDate,
        "semesterTotalWeeks": 25,
        "defaultClassDuration": 45,
        "defaultBreakDuration": 5,
        "firstDayOfWeek": 1
    };

    try {
        console.log("正在尝试导入课表配置...");
        const configJsonString = JSON.stringify(courseConfigData);

        const result = await window.AndroidBridgePromise.saveCourseConfig(configJsonString);

        if (result === true) {
            console.log("课表配置导入成功！");
            AndroidBridge.showToast("测试配置导入成功！开学日期: " + startDate);
        } else {
            console.log("课表配置导入未成功，结果：" + result);
            AndroidBridge.showToast("测试配置导入失败，请查看日志。");
        }
    } catch (error) {
        console.error("导入配置时发生错误:", error);
        AndroidBridge.showToast("导入配置失败: " + error.message);
    }
}


/**
 * 编排整个课程导入流程。
 * 在任何一步用户取消或发生错误时，都会立即退出，AndroidBridge.notifyTaskCompletion()应该只在成功后调用  
 */
async function runImportFlow() {
    AndroidBridge.showToast("课程导入流程即将开始...");

    // 1. 公告和前置检查。
    const alertConfirmed = await promptUserToStart();
    if (!alertConfirmed) {
        return; // 用户取消，立即退出函数
    }
    
    // 2. 选择校区。
    const isKaramayCampus = await selectCampus();
    if (isKaramayCampus === null) return;

    // 3. 获取学期。
    const termCode = await getTermCode();
    if (termCode === null) {
        AndroidBridge.showToast("导入已取消。");
        // 用户取消，直接退出
        return;
    }

    // 4. 获取课程数据
    const py_kbcx_ew = await fetchData (termCode);
    if (py_kbcx_ew === null) {
        AndroidBridge.showToast("导入已取消。");
        // 请求失败或无数据，直接退出
        return;
    }

    // 5. 解析课程信息。
    await parseCourses(py_kbcx_ew, isKaramayCampus);
    
    // 6. 导入时间段数据。
    await importPresetTimeSlots(isKaramayCampus);
    
    // 7. 保存配置数据 (例如学期开始日期)
    await saveConfig();

    // 8. 流程**完全成功**，发送结束信号。
    AndroidBridge.showToast("所有任务已完成！");
    AndroidBridge.notifyTaskCompletion();
}

// 启动所有演示
runImportFlow();