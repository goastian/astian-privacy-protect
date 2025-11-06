/**
 * Script de prueba simple para cryptominers
 * Usar en la consola del navegador para probar la detección
 */

// Función para simular minería CPU intensiva
function simulateMining() {
    console.log('🧪 Iniciando simulación de minería...');
    
    let startTime = Date.now();
    let iterations = 0;
    
    const miningLoop = setInterval(() => {
        // Simular trabajo de minería
        for (let i = 0; i < 100000; i++) {
            Math.random() * Math.random();
        }
        
        iterations++;
        const elapsed = Date.now() - startTime;
        
        if (elapsed > 5000) { // 5 segundos
            clearInterval(miningLoop);
            console.log(`⛏️ Simulación completada: ${iterations} iteraciones en ${elapsed}ms`);
        } else {
            console.log(`⛏️ Minando... iteración ${iterations}`);
        }
    }, 100);
}

// Función para crear Web Worker sospechoso
function createSuspiciousWorker() {
    console.log('🔧 Creando Web Worker sospechoso...');
    
    const workerScript = `
        self.onmessage = function(e) {
            if (e.data === 'mine') {
                console.log('Worker: Iniciando minería...');
                
                // Simular trabajo intensivo
                let result = 0;
                for (let i = 0; i < 1000000; i++) {
                    result += Math.random() * Math.random();
                }
                
                self.postMessage({type: 'hash', result: result});
            }
        };
    `;
    
    try {
        const blob = new Blob([workerScript], { type: 'application/javascript' });
        const worker = new Worker(URL.createObjectURL(blob));
        
        worker.onmessage = function(e) {
            console.log('Worker: Hash calculado:', e.data.result);
        };
        
        worker.postMessage('mine');
        console.log('✅ Web Worker creado exitosamente');
        
        // Limpiar después de 10 segundos
        setTimeout(() => {
            worker.terminate();
            console.log('🛑 Web Worker terminado');
        }, 10000);
        
    } catch (error) {
        console.log('❌ Error al crear Web Worker:', error.message);
    }
}

// Función para intentar cargar WebAssembly
function testWebAssembly() {
    console.log('⚡ Probando WebAssembly...');
    
    if (typeof WebAssembly === 'undefined') {
        console.log('❌ WebAssembly no soportado');
        return;
    }
    
    try {
        // Código WebAssembly simple (NOP)
        const wasmCode = new Uint8Array([
            0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60,
            0x00, 0x01, 0x7f, 0x03, 0x02, 0x01, 0x00, 0x07, 0x07, 0x01, 0x03, 0x6d,
            0x61, 0x69, 0x6e, 0x00, 0x00, 0x0a, 0x09, 0x01, 0x07, 0x00, 0x41, 0x2a,
            0x0f, 0x0b
        ]);
        
        WebAssembly.instantiate(wasmCode).then(result => {
            console.log('✅ WebAssembly cargado exitosamente');
            
            // Intentar ejecutar
            if (result.instance.exports.main) {
                const result_val = result.instance.exports.main();
                console.log('🔢 Resultado WebAssembly:', result_val);
            }
        }).catch(error => {
            console.log('❌ Error al cargar WebAssembly:', error.message);
        });
        
    } catch (error) {
        console.log('❌ Error:', error.message);
    }
}

// Función para hacer requests sospechosos
function testSuspiciousRequests() {
    console.log('📡 Probando requests sospechosos...');
    
    const suspiciousUrls = [
        'https://api.coinhive.com/user/balance',
        'https://cryptoloot.pro/api/user/balance',
        'https://webmine.pro/api/user/balance',
        'https://miner.pr0gramm.com/api/stats'
    ];
    
    suspiciousUrls.forEach((url, index) => {
        setTimeout(() => {
            console.log(`🌐 Intentando request a: ${url}`);
            
            fetch(url)
                .then(response => {
                    console.log(`✅ Request exitoso a ${url}:`, response.status);
                })
                .catch(error => {
                    console.log(`❌ Request bloqueado a ${url}:`, error.message);
                });
        }, index * 1000);
    });
}

// Función para monitorear CPU
function monitorCPU() {
    console.log('📊 Iniciando monitoreo de CPU...');
    
    let startTime = performance.now();
    let iterations = 0;
    
    const monitorLoop = setInterval(() => {
        const endTime = performance.now();
        const duration = endTime - startTime;
        
        if (duration > 1000) {
            const cpuUsage = (iterations / duration) * 1000;
            console.log(`📊 CPU Usage estimado: ${cpuUsage.toFixed(2)}%`);
            
            startTime = performance.now();
            iterations = 0;
        }
        
        // Trabajo ligero para medir
        Math.random();
        iterations++;
    }, 10);
    
    // Detener después de 30 segundos
    setTimeout(() => {
        clearInterval(monitorLoop);
        console.log('📊 Monitoreo de CPU detenido');
    }, 30000);
}

// Función principal para ejecutar todas las pruebas
function runAllTests() {
    console.log('🧪 === INICIANDO PRUEBAS DE CRYPTOMINER ===');
    console.log('⏰ Tiempo de inicio:', new Date().toLocaleTimeString());
    
    // Verificar si la extensión está activa
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
        console.log('✅ Extensión detectada');
    } else {
        console.log('❌ Extensión NO detectada');
    }
    
    // Ejecutar pruebas secuencialmente
    setTimeout(() => {
        console.log('\n🔧 Prueba 1: Web Worker');
        createSuspiciousWorker();
    }, 1000);
    
    setTimeout(() => {
        console.log('\n⚡ Prueba 2: WebAssembly');
        testWebAssembly();
    }, 3000);
    
    setTimeout(() => {
        console.log('\n⛏️ Prueba 3: Minería CPU');
        simulateMining();
    }, 5000);
    
    setTimeout(() => {
        console.log('\n📡 Prueba 4: Requests sospechosos');
        testSuspiciousRequests();
    }, 7000);
    
    setTimeout(() => {
        console.log('\n📊 Prueba 5: Monitoreo de CPU');
        monitorCPU();
    }, 9000);
    
    console.log('\n⏳ Todas las pruebas se ejecutarán automáticamente...');
    console.log('👀 Observa la consola y la extensión para ver si detecta las actividades');
}

// Exportar funciones para uso manual
window.cryptominerTest = {
    simulateMining,
    createSuspiciousWorker,
    testWebAssembly,
    testSuspiciousRequests,
    monitorCPU,
    runAllTests
};

console.log('🧪 Script de prueba de cryptominers cargado');
console.log('📝 Usa cryptominerTest.runAllTests() para ejecutar todas las pruebas');
console.log('📝 O usa las funciones individuales:');
console.log('   - cryptominerTest.simulateMining()');
console.log('   - cryptominerTest.createSuspiciousWorker()');
console.log('   - cryptominerTest.testWebAssembly()');
console.log('   - cryptominerTest.testSuspiciousRequests()');
console.log('   - cryptominerTest.monitorCPU()');


