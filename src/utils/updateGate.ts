/**
 * Trava de atualização do app.
 *
 * O PWA se atualiza sozinho — comportamento certo para um público que não deve
 * decidir nada técnico. Mas a atualização recarrega a página, e se pegar o
 * usuário com fotos capturadas e ainda não confirmadas, elas se perdem sem
 * explicação. Este módulo permite marcar "trabalho em andamento": a atualização
 * espera e é aplicada assim que a tela fica livre.
 */

let busyCount = 0;
const idleCallbacks: Array<() => void> = [];

/** Marca o início de um trabalho que não pode ser interrompido por reload. */
export function markBusy(): void {
    busyCount++;
}

/** Marca o fim do trabalho. Ao zerar, executa o que ficou esperando. */
export function markIdle(): void {
    busyCount = Math.max(0, busyCount - 1);
    if (busyCount === 0) {
        while (idleCallbacks.length > 0) {
            const fn = idleCallbacks.shift();
            try {
                fn?.();
            } catch (err) {
                console.error('[updateGate] Erro em callback adiado:', err);
            }
        }
    }
}

/** Executa imediatamente se a tela está livre; senão, assim que ficar. */
export function runWhenIdle(fn: () => void): void {
    if (busyCount === 0) {
        fn();
    } else {
        idleCallbacks.push(fn);
    }
}
