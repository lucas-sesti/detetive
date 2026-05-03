import React, {useState, useEffect, useRef, useMemo} from 'react';
import {api, getPlayerId} from './lib/api';
import {
    GamePhase,
    Role,
    Item,
    Player,
    GameState,
    SecretActionType,
    SecretActionPayload
} from './types';
import {
    MansionCard,
    MansionButton,
    MansionInput,
    MansionLabel,
    MansionBadge,
    cn
} from './components/MansionUI';
import {motion, AnimatePresence} from 'motion/react';
import {
    Watch,
    Circle,
    Mail,
    Image,
    Key,
    Clock,
    Briefcase,
    Wine,
    Glasses,
    Users,
    Sword,
    Eye,
    Shuffle,
    HandMetal,
    Timer,
    Skull,
    ShieldCheck,
    Trophy,
    ArrowRight,
    Lock,
    MessageSquare,
    ChevronRight
} from 'lucide-react';

import introAudio from './assets/audios/introducao.mp3';
import interrogationAudio from './assets/audios/interrogatorio.mp3';
import bibsAvatar from './assets/images/characters/bibs.png';
import gbAvatar from './assets/images/characters/gb.png';
import lavisAvatar from './assets/images/characters/lavis.png';
import lucasAvatar from './assets/images/characters/lucas.png';
import matAvatar from './assets/images/characters/mat.png';
import melAvatar from './assets/images/characters/mel.png';

const AVATARS = ['bibs', 'gb', 'lavis', 'lucas', 'mat', 'mel', '🤵', '💃'];

const AVATAR_IMAGES: Record<string, string> = {
    bibs: bibsAvatar,
    gb: gbAvatar,
    lavis: lavisAvatar,
    lucas: lucasAvatar,
    mat: matAvatar,
    mel: melAvatar,
};

const AVATAR_LABELS: Record<string, string> = {
    bibs: 'Bibs',
    gb: 'GB',
    lavis: 'Lavis',
    lucas: 'Lucas',
    mat: 'Mat',
    mel: 'Mel',
    '🤵': 'Invitado',
    '💃': 'Invitada',
};

const AvatarDisplay = ({avatar, className, shape = 'rounded'}: { avatar: string, className?: string, shape?: 'rounded' | 'circle' }) => {
    const imageSrc = AVATAR_IMAGES[avatar] ?? (avatar.startsWith('http') || avatar.startsWith('/') ? avatar : null);
    if (imageSrc) {
        return (
            <div className={cn(
                "overflow-hidden flex items-center justify-center",
                shape === 'circle' ? "rounded-full" : "rounded-xl",
                className
            )}>
                <img
                    src={imageSrc}
                    alt="Avatar"
                    className="w-full h-full object-contain pointer-events-none"
                    referrerPolicy="no-referrer"
                />
            </div>
        );
    }
    return <span className={className}>{avatar}</span>;
};

const SecretActionButton = ({label, icon, onClick, danger}: {
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    danger?: boolean
}) => (
    <MansionButton
        onClick={onClick}
        variant={danger ? "danger" : "secondary"}
        className="flex flex-col gap-4 p-8 rounded-[2rem] items-center justify-center aspect-square w-full max-w-[240px] transform hover:scale-105 transition-all shadow-[0_0_30px_rgba(255,255,255,0.05)] border-white/5"
    >
        <div className="scale-150 mb-2">
            {icon}
        </div>
        <span className="text-[10px] font-black tracking-[0.2em] uppercase opacity-60">{label}</span>
    </MansionButton>
);

const pickTarget = (state: GameState, myId: string) => {
    return state.players.find(p => p.id !== myId && p.isAlive);
};

const Typewriter = ({text, delay = 50, onDone}: { text: string; delay?: number; onDone?: () => void }) => {
    const [currentText, setCurrentText] = useState("");
    const [currentIndex, setCurrentIndex] = useState(0);

    useEffect(() => {
        if (currentIndex < text.length) {
            const timeout = setTimeout(() => {
                setCurrentText((prevText) => prevText + text[currentIndex]);
                setCurrentIndex((prevIndex) => prevIndex + 1);
            }, delay);

            return () => clearTimeout(timeout);
        } else if (onDone) {
            onDone();
        }
    }, [currentIndex, delay, text, onDone]);

    return <span>{currentText}</span>;
};

const INTRO_LINES: { text: string; start: number }[] = [
    { text: "Bienvenidos a Blackwood Manor...", start: 0 },
    { text: "Desafortunadamente, la noche dio un giro trágico.", start: 4.0 },
    { text: "Ha ocurrido un asesinato en los pasillos sombríos", start: 9.0 },
    { text: "y el culpable todavía camina entre nosotros.", start: 13.5 },
    { text: "Nadie se irá hasta que se revele la verdad.", start: 17.0 },
];

const NarratorIntro = () => {
    const [activeIdx, setActiveIdx] = useState(0);
    const [done, setDone] = useState(false);

    useEffect(() => {
        const audio = new Audio(introAudio);
        audio.play().catch(() => {});

        const onTime = () => {
            const t = audio.currentTime;
            let idx = 0;
            for (let i = 0; i < INTRO_LINES.length; i++) {
                if (t >= INTRO_LINES[i].start) idx = i;
            }
            setActiveIdx(idx);
        };
        const onEnd = () => setDone(true);
        audio.addEventListener('timeupdate', onTime);
        audio.addEventListener('ended', onEnd);

        const fallback = setTimeout(() => setDone(true), 22000);

        return () => {
            audio.pause();
            audio.currentTime = 0;
            audio.removeEventListener('timeupdate', onTime);
            audio.removeEventListener('ended', onEnd);
            clearTimeout(fallback);
        };
    }, []);

    return (
        <motion.div
            key="intro"
            initial={{opacity: 0}}
            animate={{opacity: 1}}
            exit={{opacity: 0}}
            transition={{duration: 1.5}}
            className="w-full max-w-3xl text-center flex flex-col items-center justify-center min-h-[400px] px-4"
        >
            <MansionCard className="p-6 md:p-12 border-none bg-transparent">
                <motion.div
                    initial={{scale: 0.8, opacity: 0}}
                    animate={{scale: 1, opacity: 1}}
                    transition={{duration: 1.5, ease: "easeOut"}}
                    className="mb-6 md:mb-8"
                >
                    <Skull className="w-12 h-12 md:w-16 md:h-16 mx-auto text-white/20 mb-4"/>
                </motion.div>

                <div className="font-serif italic text-xl md:text-3xl leading-relaxed text-white/90 min-h-[220px] flex items-center justify-center px-2">
                    <AnimatePresence mode="wait">
                        <motion.p
                            key={activeIdx}
                            initial={{opacity: 0, y: 10}}
                            animate={{opacity: 1, y: 0}}
                            exit={{opacity: 0, y: -10}}
                            transition={{duration: 0.8, ease: "easeOut"}}
                        >
                            {INTRO_LINES[activeIdx].text}
                        </motion.p>
                    </AnimatePresence>
                </div>

                {done && (
                    <motion.div
                        initial={{opacity: 0}}
                        animate={{opacity: 1}}
                        transition={{duration: 1.2}}
                        className="mt-8 md:mt-12 text-xs md:text-sm uppercase tracking-[0.4em] font-bold text-red-500 animate-pulse"
                    >
                        Preparaos
                    </motion.div>
                )}
            </MansionCard>
        </motion.div>
    );
};

const RandomEventPopup = ({message}: { message: string }) => {
    return (
        <motion.div
            initial={{opacity: 0, scale: 0.9, y: 20}}
            animate={{opacity: 1, scale: 1, y: 0}}
            exit={{opacity: 0.0, scale: 0.9, y: 20}}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-6"
        >
            <MansionCard
                className="w-full max-w-md border-red-500/50 bg-red-950/20 text-center py-12 p-8 shadow-[0_0_50px_rgba(239,68,68,0.2)]">
                <motion.div
                    animate={{
                        rotate: [0, -1, 1, -1, 1, 0],
                        scale: [1, 1.05, 1]
                    }}
                    transition={{repeat: Infinity, duration: 2}}
                    className="mb-6"
                >
                    <Skull className="w-16 h-16 mx-auto text-red-500"/>
                </motion.div>
                <MansionLabel className="text-red-400 text-sm tracking-[0.5em] mb-4">SUCESO IMPREVISTO</MansionLabel>
                <h2 className="text-2xl md:text-3xl font-serif italic text-red-50">{message}</h2>
                <div className="mt-8 flex justify-center">
                    <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                        <motion.div
                            initial={{width: "100%"}}
                            animate={{width: "0%"}}
                            transition={{duration: 5, ease: "linear"}}
                            className="h-full bg-red-500"
                        />
                    </div>
                </div>
            </MansionCard>
        </motion.div>
    );
};

const InterrogationIntro = ({timer}: { timer: number }) => {
    useEffect(() => {
        const audio = new Audio(interrogationAudio);
        audio.play().catch(() => {});
        return () => { audio.pause(); audio.currentTime = 0; };
    }, []);

    return (
        <motion.div
            key="interrogation-intro"
            initial={{opacity: 0}}
            animate={{opacity: 1}}
            exit={{opacity: 0}}
            transition={{duration: 1.2}}
            className="fixed inset-0 z-[80] flex flex-col items-center justify-center bg-black gap-8 px-6"
        >
            <motion.div
                initial={{scale: 0.8, opacity: 0}}
                animate={{scale: 1, opacity: 1}}
                transition={{duration: 1.5, ease: "easeOut"}}
                className="text-center"
            >
                <MansionLabel className="mb-4 tracking-[0.6em] md:tracking-[1em] text-white/40 block">
                    EL INTERROGATORIO
                </MansionLabel>
                <h2 className="text-4xl md:text-7xl font-serif italic text-white mb-4">
                    Benoît Blanc llega...
                </h2>
                <p className="mt-6 text-sm md:text-base font-serif italic text-white/60 max-w-xl mx-auto leading-relaxed">
                    "Cada uno tendrá su momento. Cada palabra será sopesada. La verdad siempre se filtra entre las grietas."
                </p>
                <div className="flex items-center justify-center gap-4 mt-12">
                    <motion.div
                        animate={{scaleX: [0, 1]}}
                        transition={{duration: 18, ease: "linear"}}
                        className="w-48 md:w-96 h-0.5 bg-red-500 origin-left"
                    />
                </div>
            </motion.div>

            <p className="text-xs text-red-500/50 uppercase font-black tracking-[0.4em] animate-pulse">
                El primer sospechoso llega en {timer}s
            </p>
        </motion.div>
    );
};

const InterrogationQuestionPopup = ({question, timer}: { question: string, timer: number }) => {
    return (
        <motion.div
            initial={{opacity: 0, scale: 0.95}}
            animate={{opacity: 1, scale: 1}}
            exit={{opacity: 0, scale: 0.95}}
            className="fixed inset-0 z-[110] flex items-center justify-center bg-black/90 backdrop-blur-xl p-6"
        >
            <MansionCard
                className="w-full max-w-lg border-white/20 bg-black/40 p-8 md:p-12 text-center shadow-[0_0_100px_rgba(255,255,255,0.1)]">
                <MansionLabel className="mb-6 tracking-[0.5em] text-white/40 block">BENOÎT BLANC
                    PREGUNTA:</MansionLabel>
                <h2 className="text-3xl md:text-5xl font-serif italic text-white leading-tight min-h-[160px] flex items-center justify-center">
                    "{question}"
                </h2>
                <div className="mt-8 flex flex-col items-center gap-4">
                    <div className="w-24 h-0.5 bg-white/20 mb-4"/>
                    <p className="text-xs text-white/40 uppercase tracking-widest font-bold">La defensa comienza
                        en {timer}s...</p>
                </div>
            </MansionCard>
        </motion.div>
    );
};

const TransitionView = ({timer}: { timer: number }) => {
    return (
        <motion.div
            key="transition"
            initial={{opacity: 0}}
            animate={{opacity: 1}}
            exit={{opacity: 0}}
            className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black gap-8"
        >
            <motion.div
                initial={{scale: 0.8, opacity: 0}}
                animate={{scale: 1, opacity: 1}}
                transition={{duration: 2, ease: "easeOut"}}
                className="text-center px-6"
            >
                <MansionLabel className="mb-4 tracking-[0.6em] md:tracking-[1em] text-white/40 block">MOMENTO DEL
                    CRIMEN</MansionLabel>
                <h2 className="text-4xl md:text-7xl font-serif italic text-white mb-4">Investiga con Cuidado...</h2>
                <div className="flex items-center justify-center gap-4 mt-12">
                    <motion.div
                        animate={{scaleX: [0, 1]}}
                        transition={{duration: 8, ease: "linear"}}
                        className="w-48 md:w-96 h-0.5 bg-red-500 origin-left"
                    />
                </div>
            </motion.div>

            <p className="text-xs text-red-500/50 uppercase font-black tracking-[0.4em] animate-pulse">
                El misterio se revela en {timer}s
            </p>
        </motion.div>
    );
};

const NotificationPopup = ({notification}: { notification: { message: string, type: string } }) => {
    const icons = {
        stolen: <Skull className="w-12 h-12 text-red-500"/>,
        swapped: <Shuffle className="w-12 h-12 text-blue-400"/>,
        incriminated: <Lock className="w-12 h-12 text-red-600"/>
    };

    return (
        <motion.div
            initial={{opacity: 0, scale: 0.9, y: 50}}
            animate={{opacity: 1, scale: 1, y: 0}}
            exit={{opacity: 0, scale: 0.9, y: 50}}
            className="fixed inset-0 z-[150] flex items-center justify-center bg-black/90 p-6 backdrop-blur-xl"
        >
            <MansionCard
                className="w-full max-w-sm text-center py-12 p-8 border-white/20 shadow-[0_0_100px_rgba(255,255,255,0.1)]">
                <motion.div
                    animate={{scale: [1, 1.1, 1]}}
                    transition={{repeat: Infinity, duration: 1.5}}
                    className="mb-6 flex justify-center"
                >
                    {icons[notification.type as keyof typeof icons] || <Skull className="w-12 h-12 "/>}
                </motion.div>
                <MansionLabel className="mb-4 text-xs font-black tracking-[0.4em] text-white/40">ALERTA DE
                    SEGURIDAD</MansionLabel>
                <h2 className="text-2xl font-serif italic text-white mb-8">{notification.message}</h2>
                <MansionButton
                    onClick={() => gameState && api.action(gameState.roomId, 'clear_notification')}
                    className="w-full"
                    variant="secondary"
                >
                    MÁS CUIDADO LA PRÓXIMA VEZ
                </MansionButton>
            </MansionCard>
        </motion.div>
    );
};

export default function App() {
    const [gameState, setGameState] = useState<GameState | null>(null);
    const [nickname, setNickname] = useState('');
    const [selectedAvatar, setSelectedAvatar] = useState(AVATARS[0]);
    const [roomIdInput, setRoomIdInput] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [info, setInfo] = useState<string | null>(null);
    const [snoopResult, setSnoopResult] = useState<{ targetId: string, item: Item } | null>(null);
    const [actionTargeting, setActionTargeting] = useState<{
        type: SecretActionType,
        firstTargetId?: string
    } | null>(null);
    const roomIdRef = useRef<string | null>(null);
    const playerId = getPlayerId();

    const me = useMemo(() => {
        return gameState?.players.find(p => p.id === playerId);
    }, [gameState, playerId]);

    const killers = useMemo(() => {
        return gameState?.players.filter(p => p.role === Role.KILLER) || [];
    }, [gameState]);

    const handleMessages = (messages: { type: string; data: unknown }[]) => {
        messages.forEach(msg => {
            if (msg.type === 'event_message') {
                setInfo(msg.data as string);
                setTimeout(() => setInfo(null), 10000);
            } else if (msg.type === 'snoop_result') {
                setSnoopResult(msg.data as { targetId: string; item: Item });
            } else if (msg.type === 'error') {
                setError(msg.data as string);
                setTimeout(() => setError(null), 3000);
            }
        });
    };

    const isHostRef = useRef(false);

    const applyState = (next: GameState) => {
        setGameState(prev => {
            if (prev?.phase !== next.phase) { setSnoopResult(null); setActionTargeting(null); }
            return next;
        });
        isHostRef.current = next.players.find(p => p.id === playerId)?.isHost ?? false;
    };

    useEffect(() => {
        if (!roomIdRef.current) return;
        const interval = setInterval(async () => {
            try {
                if (isHostRef.current && roomIdRef.current) {
                    const res = await api.tick(roomIdRef.current);
                    if (res) applyState(res.state);
                } else {
                    const res = await api.getState(roomIdRef.current!);
                    if (res) { handleMessages(res.messages ?? []); applyState(res.state); }
                }
            } catch {}
        }, 1000);
        return () => clearInterval(interval);
    }, [roomIdRef.current]);

    const action = (type: string, payload?: unknown) => {
        if (!roomIdRef.current) return;
        api.action(roomIdRef.current, type, payload)
            .then(res => { if (res?.state) applyState(res.state); })
            .catch(() => {});
    };

    const handleRevealRole = () => action('reveal_role');
    const handleSkipGossip = () => action('skip_gossip');
    const handleSkipInterrogation = () => action('skip_interrogation');
    const handleLockVote = (targetId: string) => action('lock_vote', { targetId });
    const handleStartGame = () => action('start_game');
    const handleGossipVote = (targetId: string) => action('gossip_vote', { targetId });
    const handleVote = (targetId: string) => action('vote', { targetId });
    const handleToggleItemExposure = () => action('toggle_item_exposure');

    const handleCreateRoom = async () => {
        if (!nickname) { setError("Por favor, introduce un nombre"); return; }
        try {
            const state = await api.createRoom(nickname, selectedAvatar);
            roomIdRef.current = state.roomId;
            isHostRef.current = true;
            setGameState(state);
        } catch (e: any) { setError(e.message); }
    };

    const handleJoinRoom = async () => {
        if (!nickname || !roomIdInput) { setError("Introduce tu nombre y el código de la sala"); return; }
        try {
            const state = await api.joinRoom(roomIdInput, nickname, selectedAvatar);
            roomIdRef.current = state.roomId;
            isHostRef.current = false;
            setGameState(state);
        } catch (e: any) { setError(e.message); }
    };

    const handleSecretAction = (type: SecretActionType) => {
        if (type === SecretActionType.SKIP) {
            action('secret_action', { type, targetId1: playerId });
            return;
        }
        setActionTargeting({type});
    };

    const handleTargetSelect = (targetId: string) => {
        if (!actionTargeting) return;
        if (actionTargeting.type === SecretActionType.SHUFFLE) {
            if (!actionTargeting.firstTargetId) {
                setActionTargeting({...actionTargeting, firstTargetId: targetId});
            } else {
                action('secret_action', { type: SecretActionType.SHUFFLE, targetId1: actionTargeting.firstTargetId, targetId2: targetId });
                setActionTargeting(null);
            }
        } else {
            action('secret_action', { type: actionTargeting.type, targetId1: targetId });
            setActionTargeting(null);
        }
    };

    if (!gameState) {
        return (
            <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(120,40,40,0.15),_transparent_60%)] pointer-events-none" />
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,_rgba(0,0,0,0.6),_transparent_50%)] pointer-events-none" />

                <motion.div
                    initial={{opacity: 0, y: 20}}
                    animate={{opacity: 1, y: 0}}
                    transition={{duration: 0.8}}
                    className="w-full max-w-3xl relative z-10"
                >
                    <div className="text-center mb-10">
                        <div className="flex items-center justify-center gap-4 mb-3">
                            <div className="h-px w-12 bg-gradient-to-r from-transparent to-red-500/40" />
                            <Skull className="w-6 h-6 text-red-500/60" />
                            <div className="h-px w-12 bg-gradient-to-l from-transparent to-red-500/40" />
                        </div>
                        <h1 className="text-4xl sm:text-6xl font-serif tracking-tight text-white drop-shadow-[0_0_30px_rgba(255,255,255,0.1)]">
                            DEAD MAN'S PARTY
                        </h1>
                        <p className="mt-3 text-[10px] sm:text-xs uppercase tracking-[0.5em] text-white/40 font-bold">
                            Un misterio en sociedad
                        </p>
                    </div>

                    <MansionCard className="p-6 sm:p-10 backdrop-blur-xl bg-black/60 border-white/10 shadow-[0_0_60px_rgba(0,0,0,0.6)]">
                        <div className="space-y-8">
                            <div>
                                <MansionLabel>Tu Nombre</MansionLabel>
                                <MansionInput
                                    value={nickname}
                                    onChange={setNickname}
                                    placeholder="Ej: Benoit Blanc"
                                />
                            </div>

                            <div>
                                <MansionLabel>Elige tu Personaje</MansionLabel>
                                <div className="grid grid-cols-4 gap-3 sm:gap-4">
                                    {AVATARS.map(a => {
                                        const isTaken = gameState?.players.some(p => p.avatar === a);
                                        const isSelected = selectedAvatar === a;
                                        return (
                                            <motion.button
                                                key={a}
                                                whileHover={!isTaken ? {y: -3} : {}}
                                                whileTap={!isTaken ? {scale: 0.97} : {}}
                                                onClick={() => !isTaken && setSelectedAvatar(a)}
                                                disabled={isTaken}
                                                className={cn(
                                                    "relative group flex flex-col items-stretch gap-2 p-2 rounded-2xl border-2 transition-all overflow-hidden",
                                                    "aspect-[3/4]",
                                                    isSelected
                                                        ? "border-red-500/70 bg-gradient-to-b from-red-950/40 to-black/60 shadow-[0_0_30px_rgba(239,68,68,0.25)]"
                                                        : "border-white/10 bg-white/[0.03] hover:border-white/30 hover:bg-white/[0.06]",
                                                    isTaken && "opacity-20 cursor-not-allowed grayscale"
                                                )}
                                            >
                                                {isSelected && (
                                                    <motion.div
                                                        layoutId="avatar-selected-glow"
                                                        className="absolute inset-0 bg-gradient-to-t from-red-500/10 to-transparent pointer-events-none"
                                                    />
                                                )}
                                                <div className="flex-1 w-full flex items-center justify-center min-h-0">
                                                    <AvatarDisplay
                                                        avatar={a}
                                                        className={cn(
                                                            "w-full h-full flex items-center justify-center text-6xl sm:text-7xl transition-transform",
                                                            isSelected && "scale-[1.03]"
                                                        )}
                                                    />
                                                </div>
                                                {isTaken && (
                                                    <span className="absolute top-2 right-2 text-[8px] uppercase tracking-wider bg-black/80 text-white/60 px-1.5 py-0.5 rounded">
                                                        En uso
                                                    </span>
                                                )}
                                            </motion.button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="space-y-3 pt-2">
                                <MansionButton onClick={handleCreateRoom} className="w-full py-4 text-base">
                                    Crear Nueva Sala
                                </MansionButton>

                                <div className="flex items-center gap-3 my-4">
                                    <div className="flex-1 h-px bg-white/10" />
                                    <span className="text-[9px] uppercase tracking-[0.4em] text-white/30 font-bold">ou</span>
                                    <div className="flex-1 h-px bg-white/10" />
                                </div>

                                <div className="flex gap-2">
                                    <MansionInput
                                        value={roomIdInput}
                                        onChange={setRoomIdInput}
                                        placeholder="Código de 6 dígitos"
                                        className="flex-1 tracking-[0.4em] uppercase font-mono text-center"
                                    />
                                    <MansionButton onClick={handleJoinRoom} variant="secondary">
                                        Entrar
                                    </MansionButton>
                                </div>
                            </div>

                            {error && (
                                <motion.p
                                    initial={{opacity: 0}}
                                    animate={{opacity: 1}}
                                    className="text-red-400 text-xs text-center font-medium"
                                >
                                    {error}
                                </motion.p>
                            )}
                        </div>
                    </MansionCard>
                </motion.div>
            </div>
        );
    }

    // Lobby View
    if (gameState.phase === GamePhase.LOBBY) {
        const MAX_PLAYERS = 8;
        const emptySlots = Math.max(0, MAX_PLAYERS - gameState.players.length);
        return (
            <div className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden">
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(120,40,40,0.15),_transparent_60%)] pointer-events-none" />
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,_rgba(0,0,0,0.6),_transparent_50%)] pointer-events-none" />

                <motion.div
                    initial={{opacity: 0, y: 20}}
                    animate={{opacity: 1, y: 0}}
                    className="w-full max-w-5xl relative z-10"
                >
                    <div className="flex flex-col sm:flex-row items-center sm:items-end justify-between gap-4 mb-8">
                        <div>
                            <MansionLabel>Sala Privada</MansionLabel>
                            <div className="flex items-center gap-3">
                                <h2 className="text-3xl sm:text-5xl font-serif tracking-[0.3em] text-white">
                                    {gameState.roomId}
                                </h2>
                                <button
                                    onClick={() => navigator.clipboard?.writeText(gameState.roomId)}
                                    className="text-[9px] uppercase tracking-widest text-white/40 hover:text-white/80 border border-white/10 hover:border-white/30 rounded-full px-3 py-1 transition-all"
                                    title="Copiar código"
                                >
                                    Copiar
                                </button>
                            </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                            <MansionLabel>Invitados</MansionLabel>
                            <div className="flex items-center gap-2">
                                <Users className="w-5 h-5 text-white/40" />
                                <span className="text-2xl font-mono">
                                    {gameState.players.length}<span className="text-white/30">/{MAX_PLAYERS}</span>
                                </span>
                            </div>
                        </div>
                    </div>

                    <MansionCard className="p-6 sm:p-10 backdrop-blur-xl bg-black/60 border-white/10 shadow-[0_0_60px_rgba(0,0,0,0.6)]">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-8">
                            {gameState.players.map((p, idx) => (
                                <motion.div
                                    key={p.id}
                                    initial={{opacity: 0, y: 10}}
                                    animate={{opacity: 1, y: 0}}
                                    transition={{delay: idx * 0.05}}
                                    className={cn(
                                        "relative aspect-[3/4] flex flex-col items-stretch p-2 rounded-2xl border-2 overflow-hidden",
                                        p.id === playerId
                                            ? "border-red-500/60 bg-gradient-to-b from-red-950/30 to-black/60 shadow-[0_0_25px_rgba(239,68,68,0.2)]"
                                            : "border-white/10 bg-white/[0.04]"
                                    )}
                                >
                                    {p.isHost && (
                                        <span className="absolute top-2 left-2 z-10 text-[8px] uppercase tracking-widest font-bold bg-white text-black px-2 py-0.5 rounded-full">
                                            Host
                                        </span>
                                    )}
                                    {p.id.startsWith('bot_') && (
                                        <span className="absolute top-2 right-2 z-10 text-[8px] uppercase tracking-widest font-bold bg-white/10 text-white/60 px-2 py-0.5 rounded-full">
                                            Bot
                                        </span>
                                    )}
                                    <div className="flex-1 w-full flex items-center justify-center min-h-0">
                                        <AvatarDisplay
                                            avatar={p.avatar}
                                            className="w-full h-full flex items-center justify-center text-6xl sm:text-7xl"
                                        />
                                    </div>
                                    <div className="flex flex-col items-center pb-1 pt-1">
                                        <span className="text-xs sm:text-sm font-serif text-white truncate max-w-full">
                                            {p.nickname}
                                        </span>
                                    </div>
                                </motion.div>
                            ))}
                            {Array.from({length: emptySlots}).map((_, i) => (
                                <div
                                    key={`empty-${i}`}
                                    className="aspect-[3/4] flex flex-col items-center justify-center gap-2 p-3 rounded-2xl border-2 border-dashed border-white/10 bg-white/[0.02]"
                                >
                                    <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full border-2 border-dashed border-white/15 flex items-center justify-center">
                                        <Users className="w-5 h-5 text-white/20" />
                                    </div>
                                    <span className="text-[9px] uppercase tracking-[0.2em] text-white/25 font-bold italic">
                                        Esperando...
                                    </span>
                                </div>
                            ))}
                        </div>

                        {me?.isHost && (
                            <div className="space-y-3 max-w-md mx-auto">
                                <MansionButton
                                    onClick={handleStartGame}
                                    className="w-full py-4 text-base"
                                    disabled={gameState.players.length < 4}
                                >
                                    {gameState.players.length < 4
                                        ? `Esperando ${4 - gameState.players.length} invitado(s) más`
                                        : 'Iniciar Misterio'}
                                </MansionButton>
                                <MansionButton
                                    onClick={() => action('add_bot')}
                                    variant="secondary"
                                    className="w-full text-[10px]"
                                >
                                    + Añadir Bot (Prueba)
                                </MansionButton>
                            </div>
                        )}

                        {!me?.isHost && (
                            <div className="flex items-center justify-center gap-3 mt-4">
                                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                                <p className="text-center text-white/50 text-xs italic">
                                    Esperando al Anfitrión para comenzar...
                                </p>
                            </div>
                        )}
                    </MansionCard>
                </motion.div>
            </div>
        );
    }

    // Helper for Item Icon
    const ItemIcon = ({item}: { item?: Item }) => {
        switch (item) {
            case Item.KNIFE:
                return <Sword className="w-5 h-5 text-red-400"/>;
            case Item.GLASSES:
                return <Glasses className="w-5 h-5 text-blue-400"/>;
            case Item.DRINK:
                return <Wine className="w-5 h-5 text-blue-400"/>;
            case Item.WATCH:
                return <Watch className="w-5 h-5 text-blue-400"/>;
            case Item.RING:
                return <Circle className="w-5 h-5 text-blue-400"/>;
            case Item.LETTER:
                return <Mail className="w-5 h-5 text-blue-400"/>;
            case Item.PHOTOGRAPH:
                return <Image className="w-5 h-5 text-blue-400"/>;
            case Item.KEY:
                return <Key className="w-5 h-5 text-blue-400"/>;
            case Item.POCKET_WATCH:
                return <Clock className="w-5 h-5 text-blue-400"/>;
            case Item.CIGARETTE_CASE:
                return <Briefcase className="w-5 h-5 text-blue-400"/>;
            default:
                return <HandMetal className="w-5 h-5 text-blue-400"/>;
        }
    };

    return (
        <div className="min-h-screen p-4 md:p-8 flex flex-col items-center">
            {/* Header Info */}
            <div className="w-full max-w-4xl flex justify-between items-start mb-8">
                <div className="flex flex-col gap-1">
                    <MansionLabel>Fase Actual</MansionLabel>
                    <div className="flex items-center gap-2">
                        <h2 className="text-xl font-serif uppercase tracking-wider">{gameState.phase}</h2>
                        <MansionBadge>Ronda {gameState.roundCount}</MansionBadge>
                    </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                    <MansionLabel>Tiempo</MansionLabel>
                    <div className="flex items-center gap-2 text-2xl font-mono">
                        <Timer className="w-5 h-5 text-white/40"/>
                        {Math.floor(Math.max(0, gameState.timer) / 60)}:{(Math.max(0, gameState.timer) % 60).toString().padStart(2, '0')}
                    </div>
                </div>
            </div>

            <AnimatePresence>
                {gameState.activePopup && (
                    <RandomEventPopup message={gameState.activePopup.message}/>
                )}
                {me?.notification && (
                    <NotificationPopup notification={me.notification}/>
                )}
                {info && (
                    <motion.div
                        key="info-toast"
                        initial={{opacity: 0, y: -10}}
                        animate={{opacity: 1, y: 0}}
                        exit={{opacity: 0, y: -10}}
                        className="fixed top-4 left-1/2 -translate-x-1/2 z-[120] max-w-md w-[90%] bg-black/90 border border-white/15 backdrop-blur-md rounded-2xl px-4 py-3 text-white/90 text-xs italic text-center shadow-2xl"
                    >
                        {info}
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence mode="wait">
                {/* INTRO PHASE */}
                {gameState.phase === GamePhase.INTRO && (
                    <NarratorIntro/>
                )}

                {/* TRANSITION PHASE */}
                {gameState.phase === GamePhase.TRANSITION && (
                    <TransitionView timer={gameState.timer}/>
                )}

                {/* REVEAL PHASE */}
                {gameState.phase === GamePhase.REVEAL && (
                    <motion.div key="reveal" className="w-full max-w-md">
                        <MansionCard className="text-center py-12">
                            {!me?.roleRevealed ? (
                                <div className="space-y-6">
                                    <MansionLabel>El Misterio Comienza</MansionLabel>
                                    <h1 className="text-2xl sm:text-4xl font-serif mb-8">Investiga tu
                                        identidad...</h1>
                                    <MansionButton onClick={handleRevealRole} className="w-full py-8 text-xl">
                                        REVELAR PAPEL
                                    </MansionButton>
                                </div>
                            ) : (
                                <motion.div initial={{opacity: 0, y: 10}} animate={{opacity: 1, y: 0}}>
                                    <MansionLabel>Tu Papel</MansionLabel>
                                    <h1 className={cn(
                                        "text-3xl sm:text-5xl font-serif mb-4",
                                        me?.role === Role.KILLER ? "text-red-500" : "text-blue-400"
                                    )}>
                                        {me?.role === Role.KILLER ? 'ASESINO' : 'INOCENTE'}
                                    </h1>

                                    {me?.role === Role.KILLER && killers.length > 1 && (
                                        <div className="mb-6 p-4 bg-red-950/20 border border-red-500/20 rounded-2xl">
                                            <MansionLabel>Tu Cómplice</MansionLabel>
                                            <div className="flex items-center justify-center gap-2">
                                                {killers.filter(k => k.id !== playerId).map(k => (
                                                    <span key={k.id}
                                                          className="text-lg font-bold">{k.avatar} {k.nickname}</span>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    <div
                                        className="bg-white/5 py-8 px-4 rounded-3xl border border-white/10 inline-block mb-6 min-w-[200px]">
                                        <MansionLabel>Tus Objetos</MansionLabel>
                                        <div className="flex flex-col items-center gap-6 mt-4">
                                            {me?.hasKnife && (
                                                <div className="flex flex-col items-center gap-2">
                                                    <ItemIcon item={Item.KNIFE}/>
                                                    <span
                                                        className="text-2xl font-serif text-red-100">{Item.KNIFE}</span>
                                                    <span
                                                        className="text-[10px] uppercase font-bold text-red-500/50 -mt-2">Arma del Crimen</span>
                                                </div>
                                            )}
                                            <div className="flex flex-col items-center gap-2">
                                                <ItemIcon item={me?.item}/>
                                                <span className={cn(
                                                    "text-2xl font-serif",
                                                    me?.hasKnife ? "text-sm text-white/50" : ""
                                                )}>{me?.item}</span>
                                                {me?.hasKnife && <span
                                                    className="text-[10px] uppercase font-bold text-white/20 -mt-2">Disfraz</span>}
                                            </div>
                                        </div>
                                    </div>

                                    {me?.logs && me.logs.length > 0 && (
                                        <div className="mb-6 text-left max-w-xs mx-auto space-y-2">
                                            <MansionLabel className="text-[10px] opacity-40">Información
                                                Recopilada</MansionLabel>
                                            <div className="space-y-1">
                                                {me.logs.map((l, i) => (
                                                    <p key={i} className="text-xs italic text-white/60">• {l}</p>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    <p className="text-sm text-white/50 px-8 italic">
                                        Esperando a los demás invitados...
                                    </p>
                                </motion.div>
                            )}
                        </MansionCard>
                    </motion.div>
                )}

                {/* GOSSIP PHASE */}
                {(gameState.phase === GamePhase.GOSSIP || gameState.phase === GamePhase.GOSSIP_2) && (
                    <AnimatePresence mode="wait">
                        {!gameState.isSecretActionWindow ? (
                            <motion.div
                                key="gossip-question"
                                initial={{opacity: 0, x: 20}}
                                animate={{opacity: 1, x: 0}}
                                exit={{opacity: 0, x: -20}}
                                className="w-full max-w-2xl mx-auto pb-40"
                            >
                                <MansionCard className="p-8 border-l-4 border-l-white relative bg-black/40">
                                    <div className="flex justify-between items-center mb-6">
                                        <div className="flex gap-1">
                                            {[0, 1, 2].map(i => (
                                                <div key={i} className={cn(
                                                    "h-1 w-8 rounded-full transition-all",
                                                    gameState.questionIndex > i ? "bg-white" :
                                                        gameState.questionIndex === i ? "bg-white animate-pulse" : "bg-white/10"
                                                )}/>
                                            ))}
                                        </div>
                                        <MansionBadge
                                            className="bg-white/5 border-white/10 text-white/40 uppercase tracking-tighter text-[9px] font-bold">
                                            {gameState.phase === GamePhase.GOSSIP_2 ? "Fase de Rumores 2" : "Fase de Rumores"}
                                        </MansionBadge>
                                        <MansionBadge className="bg-white/5 border-white/10 text-white/40">
                                            {gameState.timer > 60 ? "Votación en Curso" : `${gameState.timer}s`}
                                        </MansionBadge>
                                    </div>

                                    <MansionLabel>Pregunta del Momento</MansionLabel>
                                    <motion.div
                                        key={gameState.questionIndex}
                                        initial={{opacity: 0, y: 10}}
                                        animate={{opacity: 1, y: 0}}
                                    >
                                        <h3 className="text-2xl font-serif leading-relaxed italic mb-8">
                                            "{gameState.currentQuestion}"
                                        </h3>

                                        <div className="space-y-2">
                                            {gameState.players.filter(p => p.isAlive).map(p => (
                                                <button
                                                    key={p.id}
                                                    onClick={() => !me?.gossipVote && me?.isAlive && p.id !== playerId && handleGossipVote(p.id)}
                                                    disabled={!!me?.gossipVote || !me?.isAlive || p.id === playerId}
                                                    className={cn(
                                                        "w-full text-sm p-4 rounded-2xl border transition-all flex items-center justify-between",
                                                        me?.gossipVote === p.id ? "bg-white text-black border-transparent" : "bg-white/5 border-white/10",
                                                        (!me?.gossipVote && me?.isAlive && p.id !== playerId) ? "hover:bg-white/10" : "opacity-30 cursor-not-allowed"
                                                    )}
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <AvatarDisplay avatar={p.avatar}
                                                                       className="w-8 h-8 flex items-center justify-center text-xl shrink-0"/>
                                                        <span className="font-medium">{p.nickname}</span>
                                                    </div>

                                                    <div className="flex items-center gap-2">
                                                        {/* Show checkmark if voted (for self) or just a status indicator if someone else voted */}
                                                        {me?.gossipVote === p.id && (
                                                            <div
                                                                className="w-6 h-6 rounded-full bg-black flex items-center justify-center text-[10px]">
                                                                {me.avatar}
                                                            </div>
                                                        )}

                                                        {/* Indicators for others who voted (voto secreto) */}
                                                        <div className="flex -space-x-1">
                                                            {gameState.players.filter(v => v.hasGossipVoted && v.gossipVote === p.id && v.id !== playerId).map(v => (
                                                                <div key={v.id}
                                                                     className="w-5 h-5 rounded-full border border-white/20 bg-white/5 flex items-center justify-center text-[8px] animate-pulse">
                                                                    ?
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>

                                        {/* Removed skip button from gossip as requested */}
                                    </motion.div>
                                </MansionCard>

                                {gameState.eventMessage && !gameState.activePopup && (
                                    <motion.div initial={{height: 0}} animate={{height: 'auto'}} className="mt-6">
                                        <MansionCard className="bg-red-950/20 border-red-500/30">
                                            <MansionLabel className="text-red-400">Registro de Evento</MansionLabel>
                                            <p className="text-lg font-serif italic text-red-200">{gameState.eventMessage}</p>
                                        </MansionCard>
                                    </motion.div>
                                )}
                            </motion.div>
                        ) : (
                            <motion.div
                                key="gossip-action"
                                initial={{opacity: 0, scale: 0.95}}
                                animate={{opacity: 1, scale: 1}}
                                exit={{opacity: 0, scale: 1.05}}
                                className="w-full max-w-2xl mx-auto flex-1 flex items-center justify-center p-4"
                            >
                                <MansionCard className={cn(
                                    "p-8 min-h-[450px] w-full flex flex-col items-center justify-center text-center relative transition-all duration-700 bg-black/40 border-red-500/20 shadow-2xl",
                                    actionTargeting ? "ring-4 ring-white/10" : "",
                                    me?.canPerformSecretAction ? "bg-red-500/10 border-red-500/40 shadow-[0_0_80px_rgba(239,68,68,0.15)]" : ""
                                )}>
                                    <div
                                        className="absolute top-4 left-0 w-full px-4 flex justify-between items-center">
                                        <MansionBadge className="bg-red-500 text-white border-none animate-pulse">Momento
                                            del Crimen</MansionBadge>
                                        <span
                                            className="text-xs font-mono text-red-500 font-bold">{gameState.timer}s</span>
                                    </div>

                                    {me?.canPerformSecretAction && me.assignedSecretAction ? (
                                        <div className="w-full">
                                            {actionTargeting ? (
                                                <motion.div initial={{opacity: 0}} animate={{opacity: 1}}
                                                            className="space-y-4">
                                                    <MansionLabel className="text-white animate-pulse">
                                                        {actionTargeting.type === SecretActionType.SHUFFLE && actionTargeting.firstTargetId
                                                            ? "Elige el Segundo Objetivo"
                                                            : `Selecciona un Objetivo para ${actionTargeting.type}`}
                                                    </MansionLabel>
                                                    <div className="grid grid-cols-2 gap-2">
                                                        {gameState.players.filter(p => p.isAlive && p.id !== playerId && p.id !== actionTargeting.firstTargetId).map(p => (
                                                            <button
                                                                key={p.id}
                                                                onClick={() => handleTargetSelect(p.id)}
                                                                className="p-3 bg-white/10 border border-white/20 rounded-xl hover:bg-white/20 transition-all flex items-center gap-2"
                                                            >
                                                                <AvatarDisplay avatar={p.avatar}
                                                                               className="w-6 h-6 flex items-center justify-center text-xl shrink-0"/>
                                                                <span
                                                                    className="text-xs font-bold truncate">{p.nickname}</span>
                                                            </button>
                                                        ))}
                                                    </div>
                                                    <MansionButton variant="secondary" className="w-full text-[10px]"
                                                                   onClick={() => setActionTargeting(null)}>
                                                        CANCELAR
                                                    </MansionButton>
                                                </motion.div>
                                            ) : (
                                                <div className="flex flex-col items-center gap-6">
                                                    <motion.div
                                                        animate={{scale: [1, 1.05, 1], rotate: [0, -1, 1, 0]}}
                                                        transition={{repeat: Infinity, duration: 2}}
                                                    >
                                                        <MansionLabel
                                                            className="mb-2 block italic text-red-400 font-bold">
                                                            ES TU TURNO DE ACTUAR:
                                                        </MansionLabel>
                                                    </motion.div>

                                                    <div className="w-full flex justify-center">
                                                        <SecretActionButton
                                                            label={me.assignedSecretAction}
                                                            icon={
                                                                me.assignedSecretAction === SecretActionType.SNOOP ?
                                                                    <Eye className="w-8 h-8"/> :
                                                                    me.assignedSecretAction === SecretActionType.STEAL ?
                                                                        <HandMetal className="w-8 h-8"/> :
                                                                        me.assignedSecretAction === SecretActionType.SWAP ?
                                                                            <Shuffle className="w-8 h-8"/> :
                                                                            me.assignedSecretAction === SecretActionType.SHUFFLE ?
                                                                                <Users className="w-8 h-8"/> :
                                                                                me.assignedSecretAction === SecretActionType.ALIBI ?
                                                                                    <ShieldCheck className="w-8 h-8"/> :
                                                                                    <Skull
                                                                                        className="w-8 h-8 text-red-500"/>
                                                            }
                                                            danger={me.assignedSecretAction === SecretActionType.PLANT_EVIDENCE}
                                                            onClick={() => handleSecretAction(me.assignedSecretAction!)}
                                                        />
                                                    </div>

                                                    {me.assignedSecretAction === SecretActionType.PLANT_EVIDENCE && (
                                                        <MansionButton
                                                            onClick={() => handleSecretAction(SecretActionType.SKIP)}
                                                            variant="secondary"
                                                            className="w-full max-w-[240px] text-[10px] py-4 mt-4"
                                                        >
                                                            NO INCRIMINAR AHORA
                                                        </MansionButton>
                                                    )}

                                                    <motion.p
                                                        initial={{opacity: 0}}
                                                        animate={{opacity: 1}}
                                                        className="text-[10px] text-red-400 font-black tracking-widest uppercase animate-bounce"
                                                    >
                                                        ¡Úsalo ahora!
                                                    </motion.p>
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="opacity-40 space-y-4">
                                            <Users className="w-16 h-16 mx-auto text-red-500 opacity-20"/>
                                            <p className="font-serif italic px-6">
                                                Otros invitados están realizando acciones sospechosas...
                                            </p>
                                        </div>
                                    )}

                                    {snoopResult && (
                                        <motion.div initial={{opacity: 0, y: 10}} animate={{opacity: 1, y: 0}}
                                                    className="mt-8 p-4 bg-white/10 rounded-2xl border border-white/20 w-full">
                                            <MansionLabel>Espionaje</MansionLabel>
                                            <p className="text-sm">
                                                {gameState.players.find(p => p.id === snoopResult.targetId)?.nickname} tiene
                                                el objeto {snoopResult.item}
                                            </p>
                                        </motion.div>
                                    )}
                                </MansionCard>
                            </motion.div>
                        )}
                    </AnimatePresence>
                )}

                {/* INTERROGATION INTRO PHASE */}
                {gameState.phase === GamePhase.INTERROGATION_INTRO && (
                    <InterrogationIntro timer={gameState.timer}/>
                )}

                {/* INTERROGATION PHASE */}
                {gameState.phase === GamePhase.INTERROGATION && (
                    <motion.div key="interrogation" className="w-full max-w-4xl py-12 pb-40">
                        <AnimatePresence>
                            {gameState.isInterrogationQuestionWindow && gameState.interrogationQuestion && (
                                <InterrogationQuestionPopup question={gameState.interrogationQuestion}
                                                            timer={gameState.timer}/>
                            )}
                        </AnimatePresence>

                        <div className="text-center mb-12">
                            <MansionLabel>Confrontación de Rumores</MansionLabel>
                            <h1 className="text-2xl sm:text-4xl font-serif">El Interrogatorio</h1>
                            <p className="mt-2 text-white/50 italic font-medium">Sospechoso {gameState.interrogationIndex + 1} de {gameState.gossipResults.length}</p>
                        </div>

                        <div className="max-w-xl mx-auto mb-12">
                            {gameState.gossipResults[gameState.interrogationIndex] && (
                                <motion.div
                                    initial={{opacity: 0, y: 30}}
                                    animate={{opacity: 1, y: 0}}
                                    key={gameState.interrogationIndex}
                                >
                                    <MansionCard className={cn(
                                        "bg-white/5 border-t-2 transition-all p-10 text-center relative",
                                        gameState.gossipResults[gameState.interrogationIndex].mostVotedId === playerId ? "border-red-500 bg-red-500/10 shadow-[0_0_50px_rgba(239,68,68,0.2)]" : "border-white/20"
                                    )}>
                                        {(!gameState.isInterrogationQuestionWindow) && gameState.interrogationQuestion && (
                                            <motion.div
                                                initial={{opacity: 0, scale: 0.8}}
                                                animate={{opacity: 1, scale: 1}}
                                                className="mb-8 p-4 bg-white/10 rounded-2xl border border-white/20"
                                            >
                                                <MansionLabel className="text-white/60 mb-2 block">PREGUNTA PARA EL
                                                    SOSPECHOSO</MansionLabel>
                                                <p className="text-xl font-serif italic text-white font-bold">"{gameState.interrogationQuestion}"</p>
                                            </motion.div>
                                        )}

                                        <MansionLabel
                                            className={gameState.gossipResults[gameState.interrogationIndex].mostVotedId === playerId ? "text-red-400" : ""}>
                                            La Acusación Popular
                                        </MansionLabel>
                                        <h3 className="text-2xl font-serif leading-relaxed italic mb-10 mt-6 px-4">
                                            "{gameState.gossipResults[gameState.interrogationIndex].question}"
                                        </h3>

                                        <div className={cn(
                                            "p-8 rounded-3xl inline-block min-w-[240px] border",
                                            gameState.gossipResults[gameState.interrogationIndex].mostVotedId === playerId ? "bg-red-500/20 border-red-500/30" : "bg-white/10 border-white/10"
                                        )}>
                                            <p className="text-[10px] uppercase font-black tracking-[0.4em] mb-3 opacity-60">El
                                                Principal Sospechoso</p>
                                            <div className="flex items-center justify-center gap-3">
                                                <AvatarDisplay
                                                    avatar={gameState.players.find(p => p.id === gameState.gossipResults[gameState.interrogationIndex].mostVotedId)?.avatar || '🤵'}
                                                    className="w-10 h-10 flex items-center justify-center text-4xl"/>
                                                <p className={cn(
                                                    "font-serif text-3xl",
                                                    gameState.gossipResults[gameState.interrogationIndex].mostVotedId === playerId ? "text-red-100" : "text-white"
                                                )}>{gameState.gossipResults[gameState.interrogationIndex].mostVotedName}</p>
                                            </div>
                                        </div>

                                        <div className="mt-12 flex flex-col items-center gap-4">
                                            <Timer className="w-8 h-8 text-white/20 animate-pulse"/>
                                            <p className="text-xs text-white/40 uppercase tracking-widest font-bold">
                                                {gameState.isInterrogationQuestionWindow
                                                    ? `Empezando en ${gameState.timer}s...`
                                                    : `Defiéndete: ${gameState.timer}s`}
                                            </p>

                                            {!gameState.isInterrogationQuestionWindow && (
                                                <div className="w-full mt-8 max-w-xs">
                                                    <MansionButton
                                                        onClick={handleSkipInterrogation}
                                                        variant={me?.isReadyToSkip ? "secondary" : "primary"}
                                                        disabled={me?.isReadyToSkip || !me?.isAlive || playerId !== gameState.gossipResults[gameState.interrogationIndex]?.mostVotedId}
                                                        className={cn("w-full text-[10px] transition-all", (me?.isReadyToSkip || playerId !== gameState.gossipResults[gameState.interrogationIndex]?.mostVotedId) && "opacity-50")}
                                                    >
                                                        {playerId !== gameState.gossipResults[gameState.interrogationIndex]?.mostVotedId
                                                            ? "ESPERANDO DEFENSA"
                                                            : me?.isReadyToSkip ? "Esperando a los demás..." : "YA DIJE TODO"}
                                                        {me?.isReadyToSkip && <span
                                                            className="ml-2 inline-block w-4 h-4 rounded-full border-2 border-white/20 border-t-white animate-spin"/>}
                                                    </MansionButton>
                                                </div>
                                            )}
                                        </div>
                                    </MansionCard>
                                </motion.div>
                            )}
                        </div>

                        <MansionCard
                            className="p-8 text-center bg-black/20 border-white/5 backdrop-blur-sm max-w-2xl mx-auto">
                            <MessageSquare className="w-10 h-10 mx-auto mb-4 opacity-20"/>
                            <h3 className="text-xl font-serif mb-2 text-white/80">La Invitación a Explicarse</h3>
                            <p className="text-xs text-white/40 italic leading-relaxed">
                                Benoît Blanc exige saber: ¿Realizaste acciones? ¿Viste algo sospechoso? ¿Alguien robó tu
                                objeto? <br/>
                                El susurro de la mansión es implacable.
                            </p>
                        </MansionCard>
                    </motion.div>
                )}

                {/* VOTING PHASE */}
                {gameState.phase === GamePhase.VOTING && (
                    <motion.div key="voting" className="w-full max-w-2xl py-12 pb-40">
                        <MansionCard className="p-8">
                            <div className="text-center mb-12">
                                <MansionLabel>Momento de la Acusación</MansionLabel>
                                <h2 className="text-3xl font-serif">¿A quién señalas como culpable?</h2>
                            </div>

                            <div className="space-y-3 mb-8">
                                {gameState.players.filter(p => p.isAlive).map(p => (
                                    <div key={p.id} className={cn(
                                        "flex items-center justify-between p-4 rounded-2xl border transition-all h-20",
                                        me?.votedFor === p.id ? "bg-white text-black border-transparent" : "bg-white/5 border-white/10",
                                        p.id === playerId && "opacity-40 grayscale pointer-events-none"
                                    )}>
                                        <div className="flex items-center gap-4">
                                            <AvatarDisplay avatar={p.avatar}
                                                           className="w-12 h-12 flex items-center justify-center text-3xl shrink-0"/>
                                            <span className="font-medium">{p.nickname}</span>
                                        </div>

                                        <div className="flex items-center gap-3">
                                            {me?.id !== p.id && !me?.hasLockedVote && me?.isAlive && (
                                                <div className="flex gap-2">
                                                    {me?.votedFor !== p.id ? (
                                                        <MansionButton
                                                            onClick={() => handleVote(p.id)}
                                                            variant="secondary"
                                                            className="px-6 py-3"
                                                        >
                                                            <ArrowRight className="w-5 h-5"/>
                                                        </MansionButton>
                                                    ) : (
                                                        <MansionButton
                                                            onClick={() => handleLockVote(p.id)}
                                                            variant="secondary"
                                                            className="bg-black/80 text-white px-6 py-3 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-widest border-2 border-white/20 hover:bg-black"
                                                        >
                                                            <Lock className="w-4 h-4"/> FIJAR
                                                        </MansionButton>
                                                    )}
                                                </div>
                                            )}

                                            {me?.votedFor === p.id && me?.hasLockedVote && (
                                                <div className="bg-black/10 p-2 rounded-xl">
                                                    <Lock className="w-5 h-5 text-black"/>
                                                </div>
                                            )}

                                            <div className="flex -space-x-2">
                                                {gameState.players.filter(v => v.votedFor === p.id).map(v => (
                                                    <div key={v.id}
                                                         className="w-6 h-6 rounded-full border border-black bg-black/20 flex items-center justify-center text-[10px]">
                                                        {v.avatar}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <p className="text-center text-xs text-white/30 italic">
                                {!me?.isAlive
                                    ? "Estás detenido. Solo observa cómo se hace justicia."
                                    : me?.hasLockedVote
                                        ? "Voto sellado. El veredicto se acerca."
                                        : "Elige a un sospechoso y usa el candado para fijar tu decisión."}
                            </p>
                        </MansionCard>
                    </motion.div>
                )}

                {/* RESULT PHASE */}
                {gameState.phase === GamePhase.RESULT && (
                    <motion.div key="result" className="w-full max-w-md text-center py-12">
                        <MansionCard className="py-12 border-t-4 border-white shadow-2xl">
                            <Skull className="w-16 h-16 mx-auto mb-6 text-white/20"/>
                            <MansionLabel>El Sistema Ha Decidido</MansionLabel>
                            <h2 className="text-2xl sm:text-4xl font-serif mb-6 leading-tight">
                                {gameState.eventMessage || "Investigación Concluida"}
                            </h2>
                            <div className="bg-white/5 p-6 rounded-2xl border border-white/10 mb-8 max-w-xs mx-auto">
                                <p className="text-white/60 italic text-sm">
                                    {gameState.players.find(p => !p.isAlive && gameState.phase === GamePhase.RESULT)
                                        ? `${gameState.players.find(p => !p.isAlive && gameState.phase === GamePhase.RESULT)?.nickname} fue detenido.`
                                        : "Nadie fue castigado en esta ronda."}
                                </p>
                            </div>
                            <p className="text-xs text-white/30 uppercase tracking-[0.3em] font-extrabold animate-pulse">
                                {gameState.timer}s restantes
                            </p>
                        </MansionCard>
                    </motion.div>
                )}

                {/* GAME OVER PHASE */}
                {gameState.phase === GamePhase.GAME_OVER && (
                    <motion.div key="gameover" className="w-full max-w-md text-center">
                        <MansionCard className="py-12 border-2 border-white/30">
                            <div className="mb-8">
                                <Trophy className={cn(
                                    "w-20 h-20 mx-auto mb-4",
                                    gameState.winner === Role.INNOCENT ? "text-blue-400" : "text-red-500 shadow-[0_0_50px_rgba(239,68,68,0.3)]"
                                )}/>
                                <MansionLabel>Fin del Juego</MansionLabel>
                                <h2 className={cn(
                                    "text-3xl sm:text-5xl font-serif tracking-tight",
                                    gameState.winner === Role.INNOCENT ? "text-blue-400" : "text-red-500"
                                )}>
                                    LA VICTORIA ES DE LOS {gameState.winner === Role.INNOCENT ? 'INOCENTES' : 'ASESINOS'}
                                </h2>
                            </div>

                            <div className="space-y-4 mb-8">
                                <MansionLabel>Papeles Revelados</MansionLabel>
                                <div className="space-y-2">
                                    {gameState.players.map(p => (
                                        <div key={p.id}
                                             className="flex items-center justify-between px-4 py-2 bg-white/5 rounded-xl text-sm">
                                            <div className="flex items-center gap-2">
                                                <AvatarDisplay avatar={p.avatar}
                                                               className="w-5 h-5 flex items-center justify-center shrink-0"/>
                                                <span
                                                    className={cn(!p.isAlive && "line-through opacity-50")}>{p.nickname}</span>
                                            </div>
                                            <span className={cn(
                                                "font-bold uppercase text-[10px]",
                                                p.role === Role.KILLER ? "text-red-400" : "text-blue-400"
                                            )}>{p.role}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <MansionButton onClick={() => window.location.reload()} className="w-full">
                                Jugar de Nuevo
                            </MansionButton>
                        </MansionCard>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Item Display footer */}
            <div
                className="fixed bottom-6 left-1/2 -translate-x-1/2 w-full max-w-sm px-4 flex flex-col gap-2 pointer-events-none">
                {me && gameState.phase !== GamePhase.TRANSITION && gameState.phase !== GamePhase.INTRO && gameState.phase !== GamePhase.INTERROGATION_INTRO && gameState.phase !== GamePhase.GAME_OVER && (
                    <>
                        {me.logs && me.logs.length > 0 && (
                            <motion.div
                                initial={{opacity: 0, y: 10}}
                                animate={{opacity: 1, y: 0}}
                                className="bg-black/95 border border-white/10 rounded-2xl p-3 backdrop-blur-xl pointer-events-auto max-h-32 overflow-y-auto scrollbar-hide shadow-2xl"
                            >
                                <MansionLabel className="text-[9px] mb-1 opacity-50">Inteligencia
                                    Recopilada</MansionLabel>
                                <div className="space-y-1">
                                    {me.logs.map((log, i) => (
                                        <p key={i} className="text-[10px] text-white/80 italic leading-tight">
                                            • {log}
                                        </p>
                                    ))}
                                </div>
                            </motion.div>
                        )}
                        <MansionCard
                            className="py-3 px-4 flex items-center justify-between border-white/20 bg-black/95 backdrop-blur-xl pointer-events-auto shadow-2xl">
                            <div className="flex items-center gap-3">
                                <AvatarDisplay avatar={me.avatar}
                                               className="w-10 h-10 flex items-center justify-center text-2xl"/>
                                <div className="flex flex-col">
                                    <span className="text-[10px] text-white/50 uppercase font-bold tracking-tighter">Tu Identidad</span>
                                    <span className="text-sm font-serif flex items-center gap-2">
                       {me.roleRevealed ? (
                           <>
                               {me.itemExposed ? (
                                   <div className="flex items-center gap-1">
                                       {me.hasKnife && <span
                                           className="text-red-500 font-bold tracking-tighter">[{Item.KNIFE}]</span>}
                                       <span className="text-white">{me.item}</span>
                                   </div>
                               ) : (
                                   <span className="text-white/40 italic">Oculto</span>
                               )}
                           </>
                       ) : (
                           <span className="text-white/40 italic">Desconocido</span>
                       )}
                     </span>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                {me.roleRevealed ? (
                                    <>
                                        {me.itemExposed && (
                                            <>
                                                {me.hasKnife && <ItemIcon item={Item.KNIFE}/>}
                                                <ItemIcon item={me.item}/>
                                            </>
                                        )}
                                        <MansionButton
                                            onClick={handleToggleItemExposure}
                                            className="py-1 px-3 text-[8px]"
                                            variant="secondary"
                                        >
                                            {me.itemExposed ? "OCULTAR" : "VER OBJETO"}
                                        </MansionButton>
                                    </>
                                ) : (
                                    <MansionButton
                                        onClick={handleRevealRole}
                                        className="py-1 px-3 text-[8px]"
                                        variant="secondary"
                                    >
                                        REVELAR
                                    </MansionButton>
                                )}
                            </div>
                        </MansionCard>
                    </>
                )}
            </div>
        </div>
    );
}
