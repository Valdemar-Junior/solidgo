/**
 * ProcessingOverlay - Aviso de processamento em tela cheia
 *
 * Público de campo é leigo: botão desabilitado não comunica "estou trabalhando",
 * e a tela parada faz a pessoa tocar de novo achando que não clicou. Este overlay
 * cobre a tela com uma mensagem clara do que está acontecendo e, por cobrir tudo,
 * bloqueia toques repetidos por natureza.
 */

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Loader2 } from 'lucide-react';
import { markBusy, markIdle } from '../utils/updateGate';

export interface ProcessingOverlayProps {
    /** O que o app está fazendo agora, em linguagem simples. */
    message: string;
    /** Linha menor de apoio (default: pede para aguardar sem fechar o app). */
    submessage?: string;
}

export default function ProcessingOverlay({
    message,
    submessage = 'Só um instante — não feche o aplicativo.',
}: ProcessingOverlayProps) {
    // Overlay visível = gravação em andamento: segura a atualização automática
    // do app, que recarregaria a tela no meio do registro.
    useEffect(() => {
        markBusy();
        return () => markIdle();
    }, []);

    return createPortal(
        <div className="fixed inset-0 bg-black bg-opacity-60 z-[10000] flex items-center justify-center p-6">
            <div className="bg-white rounded-2xl shadow-2xl px-8 py-8 flex flex-col items-center text-center max-w-xs w-full">
                <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mb-4" />
                <p className="text-lg font-bold text-gray-800 leading-snug">{message}</p>
                <p className="text-sm text-gray-500 mt-2">{submessage}</p>
            </div>
        </div>,
        document.body
    );
}
